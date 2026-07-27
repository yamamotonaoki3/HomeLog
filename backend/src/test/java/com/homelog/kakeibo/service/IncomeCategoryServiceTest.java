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
import com.homelog.kakeibo.dto.request.CreateIncomeCategoryRequest;
import com.homelog.kakeibo.dto.request.UpdateIncomeCategoryRequest;
import com.homelog.kakeibo.dto.response.IncomeCategoryResponse;
import com.homelog.kakeibo.entity.IncomeCategoryEntity;
import com.homelog.kakeibo.mapper.IncomeCategoryMapper;
import com.homelog.kakeibo.mapper.IncomeMapper;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InOrder;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class IncomeCategoryServiceTest {

    @Mock
    private IncomeCategoryMapper incomeCategoryMapper;
    @Mock
    private IncomeMapper incomeMapper;
    @Mock
    private HouseholdMemberMapper householdMemberMapper;
    @Mock
    private HouseholdMapper householdMapper;

    private IncomeCategoryService service() {
        return new IncomeCategoryService(incomeCategoryMapper, incomeMapper, householdMemberMapper, householdMapper);
    }

    private HouseholdMemberEntity memberOf(long householdId) {
        HouseholdMemberEntity member = new HouseholdMemberEntity();
        member.setHouseholdId(householdId);
        return member;
    }

    @Test
    void listCategories_初回は空ならデフォルトカテゴリーを投入する() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        List<IncomeCategoryEntity> seeded = new ArrayList<>();
        when(incomeCategoryMapper.findByHouseholdId(10L)).thenAnswer(invocation -> seeded);
        org.mockito.Mockito.doAnswer(invocation -> {
            IncomeCategoryEntity category = invocation.getArgument(0);
            category.setId((long) (seeded.size() + 1));
            seeded.add(category);
            return null;
        }).when(incomeCategoryMapper).insert(any(IncomeCategoryEntity.class));

        List<IncomeCategoryResponse> response = service().listCategories(1L);

        assertThat(response).hasSize(4);
        assertThat(response).allMatch(IncomeCategoryResponse::isDefault);
        verify(incomeCategoryMapper, times(4)).insert(any(IncomeCategoryEntity.class));
    }

    @Test
    void listCategories_世帯ロック取得後にカテゴリーを確認してデフォルトカテゴリーを投入する() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        when(incomeCategoryMapper.findByHouseholdId(10L))
                .thenReturn(List.of())
                .thenReturn(List.of());

        service().listCategories(1L);

        InOrder inOrder = inOrder(householdMapper, incomeCategoryMapper);
        inOrder.verify(householdMapper).lockById(10L);
        inOrder.verify(incomeCategoryMapper).findByHouseholdId(10L);
        inOrder.verify(incomeCategoryMapper, times(4)).insert(any(IncomeCategoryEntity.class));
    }

    @Test
    void listCategories_カスタムカテゴリーだけがある場合もデフォルトカテゴリーを投入する() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        List<IncomeCategoryEntity> categories = new ArrayList<>();
        IncomeCategoryEntity custom = new IncomeCategoryEntity();
        custom.setId(1L);
        custom.setHouseholdId(10L);
        custom.setName("カスタム");
        custom.setDefault(false);
        categories.add(custom);
        when(incomeCategoryMapper.findByHouseholdId(10L)).thenAnswer(invocation -> categories);
        org.mockito.Mockito.doAnswer(invocation -> {
            IncomeCategoryEntity category = invocation.getArgument(0);
            category.setId((long) (categories.size() + 1));
            categories.add(category);
            return null;
        }).when(incomeCategoryMapper).insert(any(IncomeCategoryEntity.class));

        List<IncomeCategoryResponse> response = service().listCategories(1L);

        assertThat(response).hasSize(5);
        assertThat(response).filteredOn(IncomeCategoryResponse::isDefault).hasSize(4);
        verify(incomeCategoryMapper, times(4)).insert(any(IncomeCategoryEntity.class));
    }

    @Test
    void listCategories_既にカテゴリーがある場合はそのまま返す() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        IncomeCategoryEntity existing = new IncomeCategoryEntity();
        existing.setId(1L);
        existing.setHouseholdId(10L);
        existing.setName("給与");
        existing.setDefault(true);
        when(incomeCategoryMapper.findByHouseholdId(10L)).thenReturn(List.of(existing));

        List<IncomeCategoryResponse> response = service().listCategories(1L);

        assertThat(response).hasSize(1);
        verify(incomeCategoryMapper, never()).insert(any());
    }

    @Test
    void listCategories_未所属の場合は404() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(null);

        assertThatThrownBy(() -> service().listCategories(1L)).isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void createCategory_正常系() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));

        IncomeCategoryResponse response = service().createCategory(1L, new CreateIncomeCategoryRequest("新カテゴリー"));

        assertThat(response.name()).isEqualTo("新カテゴリー");
        assertThat(response.isDefault()).isFalse();
        verify(incomeCategoryMapper).insert(any(IncomeCategoryEntity.class));
    }

    @Test
    void updateCategory_正常系() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        IncomeCategoryEntity category = new IncomeCategoryEntity();
        category.setId(5L);
        category.setHouseholdId(10L);
        category.setName("旧名");
        category.setDefault(false);
        when(incomeCategoryMapper.findById(5L)).thenReturn(category);

        IncomeCategoryResponse response = service().updateCategory(1L, 5L, new UpdateIncomeCategoryRequest("新名"));

        assertThat(response.name()).isEqualTo("新名");
        verify(incomeCategoryMapper).update(5L, "新名");
    }

    @Test
    void updateCategory_デフォルトカテゴリーは編集不可() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        IncomeCategoryEntity category = new IncomeCategoryEntity();
        category.setId(5L);
        category.setHouseholdId(10L);
        category.setDefault(true);
        when(incomeCategoryMapper.findById(5L)).thenReturn(category);

        assertThatThrownBy(() -> service().updateCategory(1L, 5L, new UpdateIncomeCategoryRequest("新名")))
                .isInstanceOf(BadRequestException.class);
        verify(incomeCategoryMapper, never()).update(anyLong(), any());
    }

    @Test
    void updateCategory_他世帯のカテゴリーは404() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        IncomeCategoryEntity category = new IncomeCategoryEntity();
        category.setId(5L);
        category.setHouseholdId(999L);
        when(incomeCategoryMapper.findById(5L)).thenReturn(category);

        assertThatThrownBy(() -> service().updateCategory(1L, 5L, new UpdateIncomeCategoryRequest("新名")))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void deleteCategory_正常系() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        IncomeCategoryEntity category = new IncomeCategoryEntity();
        category.setId(5L);
        category.setHouseholdId(10L);
        category.setDefault(false);
        when(incomeCategoryMapper.findById(5L)).thenReturn(category);
        when(incomeMapper.countByCategoryId(5L)).thenReturn(0);

        service().deleteCategory(1L, 5L);

        verify(incomeCategoryMapper).delete(5L);
    }

    @Test
    void deleteCategory_使用中は削除不可() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        IncomeCategoryEntity category = new IncomeCategoryEntity();
        category.setId(5L);
        category.setHouseholdId(10L);
        category.setDefault(false);
        when(incomeCategoryMapper.findById(5L)).thenReturn(category);
        when(incomeMapper.countByCategoryId(5L)).thenReturn(1);

        assertThatThrownBy(() -> service().deleteCategory(1L, 5L)).isInstanceOf(BadRequestException.class);
        verify(incomeCategoryMapper, never()).delete(anyLong());
    }

    @Test
    void deleteCategory_デフォルトカテゴリーは削除不可() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        IncomeCategoryEntity category = new IncomeCategoryEntity();
        category.setId(5L);
        category.setHouseholdId(10L);
        category.setDefault(true);
        when(incomeCategoryMapper.findById(5L)).thenReturn(category);

        assertThatThrownBy(() -> service().deleteCategory(1L, 5L)).isInstanceOf(BadRequestException.class);
        verify(incomeCategoryMapper, never()).delete(anyLong());
    }
}
