export const getPagination = (page = 1, limit = 10) => {
  const offset = (page - 1) * limit;
  return { limit: parseInt(limit), offset: parseInt(offset), page: parseInt(page) };
};

export const getPagingData = (data, page, limit) => {
  const { count: totalItems, rows: items } = data;
  const currentPage = page ? +page : 1;
  const totalPages = Math.ceil(totalItems / limit);

  return {
    items,
    pagination: {
      totalItems,
      totalPages,
      currentPage,
      pageSize: limit,
    },
  };
};
