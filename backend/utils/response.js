export const successResponse = (res, data, message = 'Success', statusCode = 200) => {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
  });
};

export const errorResponse = (res, message = 'Error', statusCode = 500, errors = null, details = null) => {
  const extra =
    details && typeof details === 'object' && !Array.isArray(details) ? details : null;
  return res.status(statusCode).json({
    success: false,
    message,
    ...(errors && { errors }),
    ...(extra && extra),
  });
};

export const paginatedResponse = (res, data, pagination, message = 'Success') => {
  return res.status(200).json({
    success: true,
    message,
    data,
    pagination,
  });
};

// Alias functions for consistency
export const createResponse = (data, message = 'Success') => {
  return {
    success: true,
    message,
    data,
  };
};

export const createErrorResponse = (message = 'Error', errors = null) => {
  return {
    success: false,
    message,
    ...(errors && { errors }),
  };
};
