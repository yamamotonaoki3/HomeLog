package com.homelog.kakeibo.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.homelog.common.exception.BadRequestException;
import com.homelog.common.exception.ResourceNotFoundException;
import com.homelog.household.entity.HouseholdMemberEntity;
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

    private KakeiboCategoryService service() {
        return new KakeiboCategoryService(kakeiboCategoryMapper, expenseMapper, householdMemberMapper);
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

        assertThat(response).hasSize(9);
        assertThat(response).allMatch(CategoryResponse::isDefault);
        verify(kakeiboCategoryMapper, times(9)).insert(any(KakeiboCategoryEntity.class));
    }

    @Test
    void listCategories_既にカテゴリーがある場合はそのまま返す() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        KakeiboCategoryEntity existing = new KakeiboCategoryEntity();
        existing.setId(1L);
        existing.setHouseholdId(10L);
        existing.setName("食費");
        existing.setDefault(true);
        when(kakeiboCategoryMapper.findByHouseholdId(10L)).thenReturn(List.of(existing));

        List<CategoryResponse> response = service().listCategories(1L);

        assertThat(response).hasSize(1);
        verify(kakeiboCategoryMapper, never()).insert(any());
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

        assertThat(response).hasSize(10);
        assertThat(response).filteredOn(CategoryResponse::isDefault).hasSize(9);
        verify(kakeiboCategoryMapper, times(9)).insert(any(KakeiboCategoryEntity.class));
    }

    @Test
    void listCategories_未所属の場合は404() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(null);

        assertThatThrownBy(() -> service().listCategories(1L)).isInstanceOf(ResourceNotFoundException.class);
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
