import { AxiosError } from 'axios';

interface ApiErrorResponse {
  error?: {
    message?: string;
    details?: string[];
  };
}

export const getApiErrorMessage = (error: unknown): string => {
  if (error && typeof error === 'object' && 'isAxiosError' in error) {
    const axiosError = error as AxiosError<ApiErrorResponse>;
    
    // Network error (no response received)
    if (!axiosError.response) {
      return 'Unable to connect to the server. Please check your connection and try again.';
    }

    const data = axiosError.response.data;
    if (data && data.error) {
      if (Array.isArray(data.error.details) && data.error.details.length > 0) {
        return data.error.details.join(', ');
      }
      const msg = data.error.message || 'Something went wrong while creating the campaign. Please try again.';
      if (msg.includes('Invalid request payload')) {
        return 'Validation failed. Please check your form inputs.';
      }
      return msg;
    }
  }
  
  if (error instanceof Error) {
    return error.message;
  }
  
  return 'Something went wrong while creating the campaign. Please try again.';
};
