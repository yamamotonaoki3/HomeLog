// 既存Java実装のErrorResponse/ErrorCode(common/exception, common/constant)と一致させる。
export type ErrorCode = 'VALIDATION_ERROR' | 'RESOURCE_NOT_FOUND' | 'DUPLICATE_RESOURCE' | 'UNAUTHORIZED' | 'INVALID_TOKEN'

export interface FieldDetail {
  field: string
  reason: string
}

export function errorResponse(code: ErrorCode, message: string, details: FieldDetail[] = []) {
  return { code, message, details }
}
