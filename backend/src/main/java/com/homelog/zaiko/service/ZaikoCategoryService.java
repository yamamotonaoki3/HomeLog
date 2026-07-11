package com.homelog.zaiko.service;

import com.homelog.common.exception.BadRequestException;
import com.homelog.common.exception.ResourceNotFoundException;
import com.homelog.household.mapper.HouseholdMemberMapper;
import com.homelog.zaiko.dto.request.CreateCategoryRequest;
import com.homelog.zaiko.dto.request.UpdateCategoryRequest;
import com.homelog.zaiko.dto.response.CategoryResponse;
import com.homelog.zaiko.entity.ZaikoCategoryEntity;
import com.homelog.zaiko.mapper.InventoryItemMapper;
import com.homelog.zaiko.mapper.ZaikoCategoryMapper;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ZaikoCategoryService {

    private static final String NOT_FOUND_MESSAGE = "カテゴリーが見つかりません";
    private static final String IN_USE_MESSAGE = "使用中のカテゴリーは削除できません";
    private static final String DEFAULT_IMMUTABLE_MESSAGE = "デフォルトカテゴリーは編集・削除できません";
    private static final List<String> DEFAULT_CATEGORY_NAMES = List.of(
            "野菜", "肉", "魚介", "乳製品", "卵", "調味料", "飲料", "冷凍食品", "乾物", "その他");

    private final ZaikoCategoryMapper zaikoCategoryMapper;
    private final InventoryItemMapper inventoryItemMapper;
    private final HouseholdMemberMapper householdMemberMapper;

    public ZaikoCategoryService(ZaikoCategoryMapper zaikoCategoryMapper, InventoryItemMapper inventoryItemMapper,
            HouseholdMemberMapper householdMemberMapper) {
        this.zaikoCategoryMapper = zaikoCategoryMapper;
        this.inventoryItemMapper = inventoryItemMapper;
        this.householdMemberMapper = householdMemberMapper;
    }

    @Transactional
    public List<CategoryResponse> listCategories(Long userId) {
        Long householdId = resolveHouseholdId(userId);
        List<ZaikoCategoryEntity> categories = zaikoCategoryMapper.findByHouseholdId(householdId);
        if (categories.isEmpty()) {
            seedDefaultCategories(householdId);
            categories = zaikoCategoryMapper.findByHouseholdId(householdId);
        }
        return categories.stream().map(this::toResponse).toList();
    }

    public CategoryResponse createCategory(Long userId, CreateCategoryRequest request) {
        Long householdId = resolveHouseholdId(userId);
        ZaikoCategoryEntity category = new ZaikoCategoryEntity();
        category.setHouseholdId(householdId);
        category.setName(request.name());
        category.setDefault(false);
        zaikoCategoryMapper.insert(category);
        return toResponse(category);
    }

    public CategoryResponse updateCategory(Long userId, Long categoryId, UpdateCategoryRequest request) {
        Long householdId = resolveHouseholdId(userId);
        ZaikoCategoryEntity category = findOwnedCategory(householdId, categoryId);
        if (category.isDefault()) {
            throw new BadRequestException(DEFAULT_IMMUTABLE_MESSAGE);
        }
        zaikoCategoryMapper.update(categoryId, request.name());
        category.setName(request.name());
        return toResponse(category);
    }

    public void deleteCategory(Long userId, Long categoryId) {
        Long householdId = resolveHouseholdId(userId);
        ZaikoCategoryEntity category = findOwnedCategory(householdId, categoryId);
        if (category.isDefault()) {
            throw new BadRequestException(DEFAULT_IMMUTABLE_MESSAGE);
        }
        if (inventoryItemMapper.countByCategoryId(categoryId) > 0) {
            throw new BadRequestException(IN_USE_MESSAGE);
        }
        zaikoCategoryMapper.delete(categoryId);
    }

    private void seedDefaultCategories(Long householdId) {
        for (String name : DEFAULT_CATEGORY_NAMES) {
            ZaikoCategoryEntity category = new ZaikoCategoryEntity();
            category.setHouseholdId(householdId);
            category.setName(name);
            category.setDefault(true);
            zaikoCategoryMapper.insert(category);
        }
    }

    private ZaikoCategoryEntity findOwnedCategory(Long householdId, Long categoryId) {
        ZaikoCategoryEntity category = zaikoCategoryMapper.findById(categoryId);
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

    private CategoryResponse toResponse(ZaikoCategoryEntity category) {
        return new CategoryResponse(category.getId(), category.getName(), category.isDefault());
    }
}
