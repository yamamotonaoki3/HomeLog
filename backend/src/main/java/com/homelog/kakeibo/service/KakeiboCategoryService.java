package com.homelog.kakeibo.service;

import com.homelog.common.exception.BadRequestException;
import com.homelog.common.exception.ResourceNotFoundException;
import com.homelog.household.mapper.HouseholdMemberMapper;
import com.homelog.kakeibo.dto.request.CreateCategoryRequest;
import com.homelog.kakeibo.dto.request.UpdateCategoryRequest;
import com.homelog.kakeibo.dto.response.CategoryResponse;
import com.homelog.kakeibo.entity.KakeiboCategoryEntity;
import com.homelog.kakeibo.mapper.ExpenseMapper;
import com.homelog.kakeibo.mapper.KakeiboCategoryMapper;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class KakeiboCategoryService {

    private static final String NOT_FOUND_MESSAGE = "カテゴリーが見つかりません";
    private static final String IN_USE_MESSAGE = "使用中のカテゴリーは削除できません";
    private static final String DEFAULT_IMMUTABLE_MESSAGE = "デフォルトカテゴリーは編集・削除できません";
    private static final List<String> DEFAULT_CATEGORY_NAMES = List.of(
            "食費", "日用品", "交際費", "光熱費", "住居費", "通信費", "医療費", "趣味・娯楽", "その他");

    private final KakeiboCategoryMapper kakeiboCategoryMapper;
    private final ExpenseMapper expenseMapper;
    private final HouseholdMemberMapper householdMemberMapper;

    public KakeiboCategoryService(KakeiboCategoryMapper kakeiboCategoryMapper, ExpenseMapper expenseMapper,
            HouseholdMemberMapper householdMemberMapper) {
        this.kakeiboCategoryMapper = kakeiboCategoryMapper;
        this.expenseMapper = expenseMapper;
        this.householdMemberMapper = householdMemberMapper;
    }

    @Transactional
    public List<CategoryResponse> listCategories(Long userId) {
        Long householdId = resolveHouseholdId(userId);
        List<KakeiboCategoryEntity> categories = kakeiboCategoryMapper.findByHouseholdId(householdId);
        if (categories.stream().noneMatch(KakeiboCategoryEntity::isDefault)) {
            seedDefaultCategories(householdId);
            categories = kakeiboCategoryMapper.findByHouseholdId(householdId);
        }
        return categories.stream().map(this::toResponse).toList();
    }

    public CategoryResponse createCategory(Long userId, CreateCategoryRequest request) {
        Long householdId = resolveHouseholdId(userId);
        KakeiboCategoryEntity category = new KakeiboCategoryEntity();
        category.setHouseholdId(householdId);
        category.setName(request.name());
        category.setDefault(false);
        kakeiboCategoryMapper.insert(category);
        return toResponse(category);
    }

    public CategoryResponse updateCategory(Long userId, Long categoryId, UpdateCategoryRequest request) {
        Long householdId = resolveHouseholdId(userId);
        KakeiboCategoryEntity category = findOwnedCategory(householdId, categoryId);
        if (category.isDefault()) {
            throw new BadRequestException(DEFAULT_IMMUTABLE_MESSAGE);
        }
        kakeiboCategoryMapper.update(categoryId, request.name());
        category.setName(request.name());
        return toResponse(category);
    }

    public void deleteCategory(Long userId, Long categoryId) {
        Long householdId = resolveHouseholdId(userId);
        KakeiboCategoryEntity category = findOwnedCategory(householdId, categoryId);
        if (category.isDefault()) {
            throw new BadRequestException(DEFAULT_IMMUTABLE_MESSAGE);
        }
        if (expenseMapper.countByCategoryId(categoryId) > 0) {
            throw new BadRequestException(IN_USE_MESSAGE);
        }
        kakeiboCategoryMapper.delete(categoryId);
    }

    private void seedDefaultCategories(Long householdId) {
        for (String name : DEFAULT_CATEGORY_NAMES) {
            KakeiboCategoryEntity category = new KakeiboCategoryEntity();
            category.setHouseholdId(householdId);
            category.setName(name);
            category.setDefault(true);
            kakeiboCategoryMapper.insert(category);
        }
    }

    private KakeiboCategoryEntity findOwnedCategory(Long householdId, Long categoryId) {
        KakeiboCategoryEntity category = kakeiboCategoryMapper.findById(categoryId);
        if (category == null || !category.getHouseholdId().equals(householdId)) {
            throw new ResourceNotFoundException(NOT_FOUND_MESSAGE);
        }
        return category;
    }

    private Long resolveHouseholdId(Long userId) {
        var member = householdMemberMapper.findByUserId(userId);
        if (member == null) {
            throw new ResourceNotFoundException("世帯グループが見つかりません");
        }
        return member.getHouseholdId();
    }

    private CategoryResponse toResponse(KakeiboCategoryEntity category) {
        return new CategoryResponse(category.getId(), category.getName(), category.isDefault());
    }
}
