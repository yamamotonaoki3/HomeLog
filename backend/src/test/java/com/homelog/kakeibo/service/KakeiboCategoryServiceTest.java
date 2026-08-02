package com.homelog.kakeibo.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.homelog.common.exception.BadRequestException;
import com.homelog.common.exception.ResourceNotFoundException;
import com.homelog.household.entity.HouseholdMemberEntity;
import com.homelog.household.mapper.HouseholdMapper;
import com.homelog.household.mapper.HouseholdMemberMapper;
import com.homelog.kakeibo.dto.request.CreateCategoryRequest;
import com.homelog.kakeibo.dto.request.UpdateCategoryRequest;
import com.homelog.kakeibo.dto.response.CategoryResponse;
import com.homelog.kakeibo.entity.KakeiboCategoryEntity;
import com.homelog.kakeibo.mapper.ExpenseMapper;
import com.homelog.kakeibo.mapper.KakeiboCategoryMapper;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InOrder;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class KakeiboCategoryServiceTest {

    @Mock
    private KakeiboCategoryMapper kakeiboCategoryMapper;
    @Mock
    private ExpenseMapper expenseMapper;
    @Mock
    private HouseholdMemberMapper householdMemberMapper;
    @Mock
    private HouseholdMapper householdMapper;

    private KakeiboCategoryService service() {
        return new KakeiboCategoryService(kakeiboCategoryMapper, expenseMapper, householdMemberMapper, householdMapper);
    }

    private HouseholdMemberEntity memberOf(long householdId) {
        HouseholdMemberEntity member = new HouseholdMemberEntity();
        member.setHouseholdId(householdId);
        return member;
    }

    @Test
    void listCategories_初回は空ならデフォルトカテゴリーを投入する() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        List<KakeiboCategoryEntity> seeded = new ArrayList<>();
        when(kakeiboCategoryMapper.findByHouseholdId(10L)).thenAnswer(invocation -> seeded);
        org.mockito.Mockito.doAnswer(invocation -> {
            KakeiboCategoryEntity category = invocation.getArgument(0);
            category.setId((long) (seeded.size() + 1));
            seeded.add(category);
            return null;
        }).when(kakeiboCategoryMapper).insert(any(KakeiboCategoryEntity.class));

        List<CategoryResponse> response = service().listCategories(1L);

        assertThat(response).hasSize(10);
        assertThat(response).allMatch(CategoryResponse::isDefault);
        verify(kakeiboCategoryMapper, times(10)).insert(any(KakeiboCategoryEntity.class));
    }

    @Test
    void listCategories_世帯ロック取得後にカテゴリーを確認してデフォルトカテゴリーを投入する() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        when(kakeiboCategoryMapper.findByHouseholdId(10L))
                .thenReturn(List.of())
                .thenReturn(List.of());

        service().listCategories(1L);

        InOrder inOrder = inOrder(householdMapper, kakeiboCategoryMapper);
        inOrder.verify(householdMapper).lockById(10L);
        inOrder.verify(kakeiboCategoryMapper).findByHouseholdId(10L);
        inOrder.verify(kakeiboCategoryMapper, times(10)).insert(any(KakeiboCategoryEntity.class));
    }

    @Test
    void listCategories_デフォルトカテゴリーが全て揃っている場合はそのまま返す() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        List<KakeiboCategoryEntity> existing = defaultCategories();
        when(kakeiboCategoryMapper.findByHouseholdId(10L)).thenReturn(existing);

        List<CategoryResponse> response = service().listCategories(1L);

        assertThat(response).hasSize(10);
        verify(kakeiboCategoryMapper, never()).insert(any());
    }

    @Test
    void listCategories_デフォルトカテゴリーが一部だけ存在する場合は不足分だけ投入する() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        List<KakeiboCategoryEntity> categories = new ArrayList<>();
        categories.add(defaultCategory(1L, "食費"));
        when(kakeiboCategoryMapper.findByHouseholdId(10L)).thenAnswer(invocation -> categories);
        org.mockito.Mockito.doAnswer(invocation -> {
            KakeiboCategoryEntity category = invocation.getArgument(0);
            category.setId((long) (categories.size() + 1));
            categories.add(category);
            return null;
        }).when(kakeiboCategoryMapper).insert(any(KakeiboCategoryEntity.class));

        List<CategoryResponse> response = service().listCategories(1L);

        assertThat(response).hasSize(10);
        assertThat(response).extracting(CategoryResponse::name).containsExactlyInAnyOrder(
                "食費", "日用品", "交際費", "光熱費", "住居費", "通信費", "医療費", "趣味・娯楽", "固定費", "その他");
        verify(kakeiboCategoryMapper, times(9)).insert(any(KakeiboCategoryEntity.class));
    }

    @Test
    void listCategories_カスタムカテゴリーだけがある場合もデフォルトカテゴリーを投入する() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        List<KakeiboCategoryEntity> categories = new ArrayList<>();
        KakeiboCategoryEntity custom = new KakeiboCategoryEntity();
        custom.setId(1L);
        custom.setHouseholdId(10L);
        custom.setName("カスタム");
        custom.setDefault(false);
        categories.add(custom);
        when(kakeiboCategoryMapper.findByHouseholdId(10L)).thenAnswer(invocation -> categories);
        org.mockito.Mockito.doAnswer(invocation -> {
            KakeiboCategoryEntity category = invocation.getArgument(0);
            category.setId((long) (categories.size() + 1));
            categories.add(category);
            return null;
        }).when(kakeiboCategoryMapper).insert(any(KakeiboCategoryEntity.class));

        List<CategoryResponse> response = service().listCategories(1L);

        assertThat(response).hasSize(11);
        assertThat(response).filteredOn(CategoryResponse::isDefault).hasSize(10);
        verify(kakeiboCategoryMapper, times(10)).insert(any(KakeiboCategoryEntity.class));
    }

    @Test
    void listCategories_未所属の場合は404() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(null);

        assertThatThrownBy(() -> service().listCategories(1L)).isInstanceOf(ResourceNotFoundException.class);
    }

    private List<KakeiboCategoryEntity> defaultCategories() {
        return List.of(
                defaultCategory(1L, "食費"),
                defaultCategory(2L, "日用品"),
                defaultCategory(3L, "交際費"),
                defaultCategory(4L, "光熱費"),
                defaultCategory(5L, "住居費"),
                defaultCategory(6L, "通信費"),
                defaultCategory(7L, "医療費"),
                defaultCategory(8L, "趣味・娯楽"),
                defaultCategory(9L, "固定費"),
                defaultCategory(10L, "その他"));
    }

    private KakeiboCategoryEntity defaultCategory(long id, String name) {
        KakeiboCategoryEntity category = new KakeiboCategoryEntity();
        category.setId(id);
        category.setHouseholdId(10L);
        category.setName(name);
        category.setDefault(true);
        return category;
    }

    @Test
    void createCategory_正常系() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));

        CategoryResponse response = service().createCategory(1L, new CreateCategoryRequest("新カテゴリー"));

        assertThat(response.name()).isEqualTo("新カテゴリー");
        assertThat(response.isDefault()).isFalse();
        verify(kakeiboCategoryMapper).insert(any(KakeiboCategoryEntity.class));
    }

    @Test
    void updateCategory_正常系() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        KakeiboCategoryEntity category = new KakeiboCategoryEntity();
        category.setId(5L);
        category.setHouseholdId(10L);
        category.setName("旧名");
        category.setDefault(false);
        when(kakeiboCategoryMapper.findById(5L)).thenReturn(category);

        CategoryResponse response = service().updateCategory(1L, 5L, new UpdateCategoryRequest("新名"));

        assertThat(response.name()).isEqualTo("新名");
        verify(kakeiboCategoryMapper).update(5L, "新名");
    }

    @Test
    void updateCategory_デフォルトカテゴリーは編集不可() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        KakeiboCategoryEntity category = new KakeiboCategoryEntity();
        category.setId(5L);
        category.setHouseholdId(10L);
        category.setDefault(true);
        when(kakeiboCategoryMapper.findById(5L)).thenReturn(category);

        assertThatThrownBy(() -> service().updateCategory(1L, 5L, new UpdateCategoryRequest("新名")))
                .isInstanceOf(BadRequestException.class);
        verify(kakeiboCategoryMapper, never()).update(anyLong(), any());
    }

    @Test
    void updateCategory_他世帯のカテゴリーは404() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        KakeiboCategoryEntity category = new KakeiboCategoryEntity();
        category.setId(5L);
        category.setHouseholdId(999L);
        when(kakeiboCategoryMapper.findById(5L)).thenReturn(category);

        assertThatThrownBy(() -> service().updateCategory(1L, 5L, new UpdateCategoryRequest("新名")))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void deleteCategory_正常系() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        KakeiboCategoryEntity category = new KakeiboCategoryEntity();
        category.setId(5L);
        category.setHouseholdId(10L);
        category.setDefault(false);
        when(kakeiboCategoryMapper.findById(5L)).thenReturn(category);
        when(expenseMapper.countByCategoryId(5L)).thenReturn(0);

        service().deleteCategory(1L, 5L);

        verify(kakeiboCategoryMapper).delete(5L);
    }

    @Test
    void deleteCategory_使用中は削除不可() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        KakeiboCategoryEntity category = new KakeiboCategoryEntity();
        category.setId(5L);
        category.setHouseholdId(10L);
        category.setDefault(false);
        when(kakeiboCategoryMapper.findById(5L)).thenReturn(category);
        when(expenseMapper.countByCategoryId(5L)).thenReturn(1);

        assertThatThrownBy(() -> service().deleteCategory(1L, 5L)).isInstanceOf(BadRequestException.class);
        verify(kakeiboCategoryMapper, never()).delete(anyLong());
    }

    @Test
    void deleteCategory_デフォルトカテゴリーは削除不可() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        KakeiboCategoryEntity category = new KakeiboCategoryEntity();
        category.setId(5L);
        category.setHouseholdId(10L);
        category.setDefault(true);
        when(kakeiboCategoryMapper.findById(5L)).thenReturn(category);

        assertThatThrownBy(() -> service().deleteCategory(1L, 5L)).isInstanceOf(BadRequestException.class);
        verify(kakeiboCategoryMapper, never()).delete(anyLong());
    }
}
