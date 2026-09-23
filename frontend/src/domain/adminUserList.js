/**
 * Admin Users list IA hints (sorting is server-side via buildAdminUsersListOrder).
 *
 * tabs/groups: All / Active / Suspended / Deleted (account state);
 *              All roles / Students / Coaches / Admins (separate)
 * primary hierarchy: account state (server-filtered); All = suspended → active
 * secondary sort: created_at DESC; Deleted → deleted_at DESC
 * relevant timestamp: created_at (joined) / deleted_at
 */

export function adminUsersListHint({ statusFilter = '', roleFilter = '', totalItems } = {}) {
  const countPart = totalItems != null ? `${totalItems} user${totalItems === 1 ? '' : 's'}` : null;
  let org;
  switch (statusFilter) {
    case 'active':
      org = 'Active accounts · newest join first';
      break;
    case 'suspended':
      org = 'Suspended accounts · newest join first';
      break;
    case 'deleted':
      org = 'Deleted accounts · most recently deleted first';
      break;
    default:
      org = 'Non-deleted · suspended before active · newest join first';
  }
  const rolePart = roleFilter
    ? ` · ${roleFilter} role filter`
    : '';
  if (countPart) return `${countPart} · ${org}${rolePart}`;
  return `${org}${rolePart}`;
}
