const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGE_LIMIT = 200;

interface PaginationInput {
  limit?: number;
  offset?: number;
}

// Clamps caller-supplied limit/offset to sane bounds so list queries stay bounded.
function normalizePagination({ limit, offset }: PaginationInput = {}) {
  const safeLimit = Math.min(
    Math.max(Number(limit) || DEFAULT_PAGE_LIMIT, 1),
    MAX_PAGE_LIMIT,
  );
  const safeOffset = Math.max(Number(offset) || 0, 0);

  return { limit: safeLimit, offset: safeOffset };
}

// Reads limit/offset off an Express req.query object into a PaginationInput.
function parsePaginationQuery(query: Record<string, unknown>): PaginationInput {
  return {
    limit: query.limit ? Number(query.limit) : undefined,
    offset: query.offset ? Number(query.offset) : undefined,
  };
}

function getAgeFromDOB(dob: Date | string) {
  const birthDate = new Date(dob);

  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();

  if (
    monthDiff < 0 ||
    (monthDiff === 0 && today.getDate() < birthDate.getDate())
  ) {
    age--;
  }

  return age;
}

export {
  getAgeFromDOB,
  normalizePagination,
  parsePaginationQuery,
  type PaginationInput,
};