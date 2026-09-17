import {
  insertTenant,
  findTenantById,
  findTenantBySlug,
  findTenants,
} from "../models/tenant.model.js";

interface CreateTenantInput {
  company_name: string;
  industry?: string | null;
  address?: string | null;
  contact_email?: string | null;
}

// Converts a name into a URL-safe slug: lowercase, alphanumeric words joined by hyphens.
function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Generates a slug from company_name and appends a numeric suffix until it's free.
async function generateUniqueSlug(company_name: string) {
  const baseSlug = slugify(company_name) || "tenant";

  let candidate = baseSlug;
  let suffix = 1;

  while (await findTenantBySlug(candidate)) {
    suffix += 1;
    candidate = `${baseSlug}-${suffix}`;
  }

  return candidate;
}

async function createTenant(data: CreateTenantInput) {
  const slug = await generateUniqueSlug(data.company_name);

  const tenant_id = await insertTenant({ ...data, slug });

  return findTenantById(tenant_id);
}

async function getAllTenants() {
  const tenants = await findTenants();

  const tenants_list = tenants.map((tenant) => ({ name: tenant.company_name, id: tenant.tenant_id}));

  return tenants_list;
}

export { createTenant, generateUniqueSlug, slugify, getAllTenants };
