/**
 * Helper to paginate in-memory or database results while setting standard
 * RFC-compliant pagination response headers and Access-Control-Expose-Headers.
 */
function paginate(items, req, res) {
  const pageParam = req.query.page;
  const limitParam = req.query.limit;
  const sortBy = req.query.sortBy;
  const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;

  let list = [...items];

  // In-memory sorting if requested
  if (sortBy) {
    list.sort((a, b) => {
      const valA = a[sortBy] ?? '';
      const valB = b[sortBy] ?? '';
      if (valA < valB) return -1 * sortOrder;
      if (valA > valB) return 1 * sortOrder;
      return 0;
    });
  }

  const total = list.length;
  const page = Math.max(1, parseInt(pageParam, 10) || 1);
  const limit = Math.max(1, parseInt(limitParam, 10) || total || 50);
  const totalPages = Math.ceil(total / limit) || 1;

  // Set HTTP pagination headers
  res.setHeader('X-Total-Count', String(total));
  res.setHeader('X-Page', String(page));
  res.setHeader('X-Limit', String(limit));
  res.setHeader('X-Total-Pages', String(totalPages));
  res.setHeader('Access-Control-Expose-Headers', 'X-Total-Count, X-Page, X-Limit, X-Total-Pages');

  const startIndex = (page - 1) * limit;
  const paginatedSlice = list.slice(startIndex, startIndex + limit);

  // If client explicitly requested pagination via query params, return envelope
  if (pageParam !== undefined || limitParam !== undefined) {
    return {
      data: paginatedSlice,
      pagination: {
        total,
        page,
        limit,
        totalPages
      }
    };
  }

  // Default array for backward compatibility
  return list;
}

module.exports = {
  paginate
};

