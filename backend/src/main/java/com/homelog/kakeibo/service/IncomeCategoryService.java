package com.homelog.kakeibo.service;

import com.homelog.common.exception.BadRequestException;
import com.homelog.common.exception.ResourceNotFoundException;
import com.homelog.household.mapper.HouseholdMapper;
import com.homelog.household.mapper.HouseholdMemberMapper;
import com.homelog.kakeibo.dto.request.CreateIncomeCategoryRequest;
import com.homelog.kakeibo.dto.request.UpdateIncomeCategoryRequest;
import com.homelog.kakeibo.dto.response.IncomeCategoryResponse;
import com.homelog.kakeibo.entity.IncomeCategoryEntity;
import com.homelog.kakeibo.mapper.IncomeCategoryMapper;
import com.homelog.kakeibo.mapper.IncomeMapper;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class IncomeCategoryService {

    private static final String NOT_FOUND_MESSAGE = "カテゴリーが見つかりません";
    private static final String IN_USE_MESSAGE = "使用中のカテゴリーは削除できません";
    private static final String DEFAULT_IMMUTABLE_MESSAGE = "デフォルトカテゴリーは編集・削除できません";
    private static final List<String> DEFAULT_CATEGORY_NAMES = List.of("給与", "ボーナス", "副業", "その他");

    private final IncomeCategoryMapper incomeCategoryMapper;
    private final IncomeMapper incomeMapper;
    private final HouseholdMemberMapper householdMemberMapper;
    private final HouseholdMapper householdMapper;

    public IncomeCategoryService(IncomeCategoryMapper incomeCategoryMapper, IncomeMapper incomeMapper,
            HouseholdMemberMapper householdMemberMapper, HouseholdMapper householdMapper) {
        this.incomeCategoryMapper = incomeCategoryMapper;
        this.incomeMapper = incomeMapper;
        this.householdMemberMapper = householdMemberMapper;
        this.householdMapper = householdMapper;
    }

    @Transactional
    public List<IncomeCategoryResponse> listCategories(Long userId) {
        Long householdId = resolveHouseholdId(userId);
        householdMapper.lockById(householdId);
        List<IncomeCategoryEntity> categories = incomeCategoryMapper.findByHouseholdId(householdId);
        if (categories.stream().noneMatch(IncomeCategoryEntity::isDefault)) {
            seedDefaultCategories(householdId);
            categories = incomeCategoryMapper.findByHouseholdId(householdId);
        }
        return categories.stream().map(this::toResponse).toList();
    }

    public IncomeCategoryResponse createCategory(Long userId, CreateIncomeCategoryRequest request) {
        Long householdId = resolveHouseholdId(userId);
        IncomeCategoryEntity category = new IncomeCategoryEntity();
        category.setHouseholdId(householdId);
        category.setName(request.name());
        category.setDefault(false);
        incomeCategoryMapper.insert(category);
        return toResponse(category);
    }

    public IncomeCategoryResponse updateCategory(Long userId, Long categoryId, UpdateIncomeCategoryRequest request) {
        Long householdId = resolveHouseholdId(userId);
        IncomeCategoryEntity category = findOwnedCategory(householdId, categoryId);
        if (category.isDefault()) {
            throw new BadRequestException(DEFAULT_IMMUTABLE_MESSAGE);
        }
        incomeCategoryMapper.update(categoryId, request.name());
        category.setName(request.name());
        return toResponse(category);
    }

    @Transactional
    public void deleteCategory(Long userId, Long categoryId) {
        Long householdId = resolveHouseholdId(userId);
        householdMapper.lockById(householdId);
        IncomeCategoryEntity category = findOwnedCategory(householdId, categoryId);
        if (category.isDefault()) {
            throw new BadRequestException(DEFAULT_IMMUTABLE_MESSAGE);
        }
        if (incomeMapper.countByCategoryId(categoryId) > 0) {
            throw new BadRequestException(IN_USE_MESSAGE);
        }
        incomeCategoryMapper.delete(categoryId);
    }

    private void seedDefaultCategories(Long householdId) {
        for (String name : DEFAULT_CATEGORY_NAMES) {
            IncomeCategoryEntity category = new IncomeCategoryEntity();
            category.setHouseholdId(householdId);
            category.setName(name);
            category.setDefault(true);
            incomeCategoryMapper.insert(category);
        }
    }

    private IncomeCategoryEntity findOwnedCategory(Long householdId, Long categoryId) {
        IncomeCategoryEntity category = incomeCategoryMapper.findById(categoryId);
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

    private IncomeCategoryResponse toResponse(IncomeCategoryEntity category) {
        return new IncomeCategoryResponse(category.getId(), category.getName(), category.isDefault());
    }
}
