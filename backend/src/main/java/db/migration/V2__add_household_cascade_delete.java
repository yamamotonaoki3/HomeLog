package db.migration;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.List;
import org.flywaydb.core.api.migration.BaseJavaMigration;
import org.flywaydb.core.api.migration.Context;

/**
 * 世帯グループ退出時、最後の1人が抜けたらhouseholdsごとCASCADE削除できるようにする（docs/details/features/F02_household.md 退出フロー対応）。
 *
 * <p>households行の直接の子（household_id経由）だけでなく、その子同士の内部参照
 * （inventory_items.category_id → zaiko_categories、inventory_items.store_id → stores、
 * shopping_list_items.inventory_item_id → inventory_items）もCASCADE化しないと、
 * 複数経路で同時に削除される行同士のFKチェックに引っかかって削除が失敗する（在庫・カテゴリー・店舗が
 * それぞれhousehold_id経由で同時にCASCADE削除対象になるため）。
 * なお「使用中のカテゴリー/店舗は削除できない」というビジネスルールはStoreService/ZaikoCategoryService側の
 * アプリケーション層チェック（登録件数の事前確認）で担保されており、このFKのON DELETE挙動には依存していないため、
 * これらをCASCADE化しても既存の削除保護ロジックに影響はない。
 *
 * <p>制約名はH2とPostgreSQLで自動採番の規則が異なる（例えばH2はPostgreSQL風の{@code <table>_<column>_fkey}を
 * 採番しない）ため、SQLに制約名を決め打ちで書くと片方のDBでしか通らない。SQLマイグレーションではなく
 * Javaマイグレーションとして実装し、information_schemaから実際の制約名を動的に取得したうえでDROP/ADDすることで、
 * H2（単体テスト）・PostgreSQL（開発・結合テスト・本番）のどちらでも同じロジックで安全に動作させる。
 * 制約が見つからない場合は例外を送出し、CASCADE化が中途半端に適用されたまま気づかず進む事故を防ぐ。
 */
public class V2__add_household_cascade_delete extends BaseJavaMigration {

    private record ForeignKeyTarget(String table, String column) {
    }

    private static final List<ForeignKeyTarget> TARGETS = List.of(
            new ForeignKeyTarget("household_members", "household_id"),
            new ForeignKeyTarget("zaiko_categories", "household_id"),
            new ForeignKeyTarget("stores", "household_id"),
            new ForeignKeyTarget("inventory_items", "household_id"),
            new ForeignKeyTarget("inventory_items", "category_id"),
            new ForeignKeyTarget("inventory_items", "store_id"),
            new ForeignKeyTarget("shopping_list_items", "household_id"),
            new ForeignKeyTarget("shopping_list_items", "inventory_item_id"));

    @Override
    public void migrate(Context context) throws Exception {
        Connection connection = context.getConnection();
        for (ForeignKeyTarget target : TARGETS) {
            String constraintName = findForeignKeyName(connection, target.table(), target.column());
            if (constraintName == null) {
                throw new IllegalStateException(
                        target.column() + " の外部キー制約が見つかりません: table=" + target.table());
            }
            try (Statement statement = connection.createStatement()) {
                statement.execute("ALTER TABLE " + target.table() + " DROP CONSTRAINT \"" + constraintName + "\"");
                statement.execute("ALTER TABLE " + target.table() + " ADD CONSTRAINT \"" + constraintName
                        + "\" FOREIGN KEY (" + target.column() + ") REFERENCES "
                        + referencedTable(target.table(), target.column()) + " (id) ON DELETE CASCADE");
            }
        }
    }

    private String referencedTable(String table, String column) {
        return switch (column) {
            case "household_id" -> "households";
            case "category_id" -> "zaiko_categories";
            case "store_id" -> "stores";
            case "inventory_item_id" -> "inventory_items";
            default -> throw new IllegalStateException("未対応の列です: table=" + table + ", column=" + column);
        };
    }

    private String findForeignKeyName(Connection connection, String tableName, String columnName) throws Exception {
        String sql = "SELECT tc.constraint_name "
                + "FROM information_schema.table_constraints tc "
                + "JOIN information_schema.key_column_usage kcu "
                + "  ON tc.constraint_name = kcu.constraint_name "
                + "  AND tc.table_schema = kcu.table_schema "
                + "WHERE tc.table_name = ? "
                + "  AND tc.constraint_type = 'FOREIGN KEY' "
                + "  AND kcu.column_name = ?";
        try (PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setString(1, tableName);
            statement.setString(2, columnName);
            try (ResultSet resultSet = statement.executeQuery()) {
                return resultSet.next() ? resultSet.getString(1) : null;
            }
        }
    }
}
