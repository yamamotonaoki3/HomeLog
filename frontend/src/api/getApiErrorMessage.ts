import { isAxiosError } from 'axios'

interface ErrorResponseBody {
  code?: string
  message?: string
}

export function getApiErrorMessage(error: unknown, fallback: string): string {
  if (isAxiosError<ErrorResponseBody>(error)) {
    const message = error.response?.data?.message
    if (message) {
      return message
    }
  }
  return fallback
}
