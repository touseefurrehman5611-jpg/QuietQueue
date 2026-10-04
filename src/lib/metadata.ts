const BRAND = 'QuietQueue';

/**
 * Builds a route title that always carries the brand suffix.
 *
 * Root sets `title.default`, but `title.template` was observed to apply
 * inconsistently across route depths on Next 16.3.8 (it rendered for
 * /visitor and /staff but not for / or /visitor/view). Using `absolute`
 * everywhere makes the rendered title deterministic on every route.
 */
export function pageTitle(name: string) {
  return { absolute: `${name} | ${BRAND}` };
}

export const SITE_NAME = BRAND;