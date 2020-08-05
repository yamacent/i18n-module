import { posix } from 'path'
import { STRATEGIES } from './constants'
import { extractComponentOptions } from './components'
import { adjustRouteDefinitionForTrailingSlash, getPageOptions } from './utils'

/**
 * @typedef {import('@nuxt/types/config/router').NuxtRouteConfig} NuxtRouteConfig
 * @typedef {import('../../types/internal').ResolvedOptions & {
 *   pagesDir: string
 *   includeUprefixedFallback: boolean
 *   trailingSlash: import('@nuxt/types/config/router').NuxtOptionsRouter['trailingSlash']
 * }} MakeRouteOptions
 *
 * @typedef {{ n: string, p: string }} RouteEntry
 * @typedef {{
 *   all: RouteEntry[]
 *   byName: Record<string, Record<import('../../types').Locale, RouteEntry>>
 *   byPath: Record<string, Record<import('../../types').Locale, RouteEntry>>
 * }} CustomRoutePaths
 */

/**
 * @param {NuxtRouteConfig[]} baseRoutes
 * @param {MakeRouteOptions} options
 * @return {{ localizedRoutes: NuxtRouteConfig[], customPathsMap: CustomRoutePaths[] }}
 */
export function makeRoutes (baseRoutes, {
  defaultLocale,
  defaultLocaleRouteNameSuffix,
  differentDomains,
  includeUprefixedFallback,
  localeCodes,
  pages,
  pagesDir,
  parsePages,
  routesNameSeparator,
  sortRoutes,
  strategy,
  trailingSlash
}) {
  /** @type {NuxtRouteConfig[]} */
  let localizedRoutes = []
  /** @type {CustomRoutePaths} */
  const customPathsMap = { byPath: {}, byName: {}, all: [] }

  /**
   * @param {NuxtRouteConfig} route
   * @param {readonly import('../../types').Locale[]} allowedLocaleCodes
   * @param {string} parentRoutePath
   * @param {boolean} [isExtraRouteTree=false]
   * @return {NuxtRouteConfig | NuxtRouteConfig[]}
   */
  const buildLocalizedRoutes = (route, allowedLocaleCodes, parentRoutePath = '', isExtraRouteTree = false) => {
    /** @type {NuxtRouteConfig[]} */
    const routes = []

    /**
     * Adds a route.
     *
     * @param {NuxtRouteConfig} localizedRoute
     * @param {import('../../types').Locale} locale
     * @param {string} parentRoutePath
     */
    const addRoute = (localizedRoute, locale, parentRoutePath) => {
      routes.push(localizedRoute)

      if (route.name) {
        const fullPath = posix.join(parentRoutePath, route.path)
        if (!customPathsMap.byName[route.name]) {
          customPathsMap.byName[route.name] = {}
        }
        if (!customPathsMap.byPath[fullPath]) {
          customPathsMap.byPath[fullPath] = {}
        }

        // For "prefix_and_default" strategy we take only first route (without the prefix) for given locale.
        if (!customPathsMap.byName[route.name][locale] || !!customPathsMap.byPath[fullPath][locale]) {
          const localizedFullPath = posix.join(parentRoutePath, localizedRoute.path)
          const size = customPathsMap.all.push({ n: localizedRoute.name, p: localizedFullPath })
          if (!customPathsMap.byName[route.name][locale]) {
            customPathsMap.byName[route.name][locale] = customPathsMap.all[size - 1]
          }
          if (!customPathsMap.byPath[fullPath][locale]) {
            customPathsMap.byPath[fullPath][locale] = customPathsMap.all[size - 1]
          }
        }
      }
    }

    // Skip route if it is only a redirect without a component.
    if (route.redirect && !route.component) {
      return route
    }

    const pageOptions = parsePages
      ? extractComponentOptions(route.component)
      : getPageOptions(route, pages, allowedLocaleCodes, pagesDir, defaultLocale)

    // Skip route if i18n is disabled on page
    if (pageOptions === false) {
      return route
    }

    // Component-specific options
    const componentOptions = {
      // @ts-ignore
      locales: localeCodes,
      ...pageOptions,
      ...{ locales: allowedLocaleCodes }
    }

    // Double check locales to remove any locales not found in pageOptions.
    // This is there to prevent children routes being localized even though they are disabled in the configuration.
    if (componentOptions.locales.length > 0 && pageOptions.locales !== undefined && pageOptions.locales.length > 0) {
      const filteredLocales = []
      for (const locale of componentOptions.locales) {
        if (pageOptions.locales.includes(locale)) {
          filteredLocales.push(locale)
        }
      }
      componentOptions.locales = filteredLocales
    }

    // Generate routes for component's supported locales
    for (let i = 0, length1 = componentOptions.locales.length; i < length1; i++) {
      const locale = componentOptions.locales[i]
      const { name } = route
      let { path } = route
      const localizedRoute = { ...route }

      // Make localized route name. Name might not exist on parent route if child has same path.
      if (name) {
        localizedRoute.name = name + routesNameSeparator + locale
      }

      // Get custom path if any
      if (componentOptions.paths && componentOptions.paths[locale]) {
        // @ts-ignore
        path = componentOptions.paths[locale]
      }

      // Generate localized children routes if any
      if (route.children) {
        localizedRoute.children = []
        for (let i = 0, length1 = route.children.length; i < length1; i++) {
          localizedRoute.children = localizedRoute.children.concat(buildLocalizedRoutes(route.children[i], [locale], parentRoutePath + path, isExtraRouteTree))
        }
      }

      const isDefaultLocale = locale === defaultLocale

      // For PREFIX_AND_DEFAULT strategy and default locale:
      // - if it's a parent route, add it with default locale suffix added (no suffix if route has children)
      // - if it's a child route of that extra parent route, append default suffix to it
      if (isDefaultLocale && strategy === STRATEGIES.PREFIX_AND_DEFAULT) {
        if (!parentRoutePath) {
          const defaultRoute = { ...localizedRoute, path }

          if (name) {
            defaultRoute.name = localizedRoute.name + routesNameSeparator + defaultLocaleRouteNameSuffix
          }

          if (route.children) {
            // Recreate child routes with default suffix added
            defaultRoute.children = []
            for (const childRoute of route.children) {
              // isExtraRouteTree argument is true to indicate that this is extra route added for PREFIX_AND_DEFAULT strategy
              defaultRoute.children = defaultRoute.children.concat(buildLocalizedRoutes(childRoute, [locale], path, true))
            }
          }

          addRoute(defaultRoute, locale, parentRoutePath)
        } else if (parentRoutePath && isExtraRouteTree && name) {
          localizedRoute.name += routesNameSeparator + defaultLocaleRouteNameSuffix
        }
      }

      const isChildWithRelativePath = parentRoutePath && !path.startsWith('/')

      // Add route prefix if needed
      const shouldAddPrefix = (
        strategy !== STRATEGIES.NO_PREFIX &&
        // No prefix if app uses different locale domains
        !differentDomains &&
        // No need to add prefix if child's path is relative
        !isChildWithRelativePath &&
        // Skip default locale if strategy is PREFIX_EXCEPT_DEFAULT
        !(isDefaultLocale && strategy === STRATEGIES.PREFIX_EXCEPT_DEFAULT)
      )

      if (shouldAddPrefix) {
        path = `/${locale}${path}`
      }

      // - Follow Nuxt and add or remove trailing slashes depending on "router.trailingSlash`
      // - If "router.trailingSlash" is not specified then default to no trailing slash (like Nuxt)
      // - Children with relative paths must not start with slash so don't append if path is empty.
      if (path.length) { // Don't replace empty (child) path with a slash!
        path = adjustRouteDefinitionForTrailingSlash(path, trailingSlash, isChildWithRelativePath)
      }

      if (shouldAddPrefix && isDefaultLocale && strategy === STRATEGIES.PREFIX && includeUprefixedFallback) {
        addRoute({ path: route.path, redirect: path }, locale, parentRoutePath)
      }

      localizedRoute.path = path

      addRoute(localizedRoute, locale, parentRoutePath)
    }

    return routes
  }

  for (let i = 0, length1 = baseRoutes.length; i < length1; i++) {
    const route = baseRoutes[i]
    localizedRoutes = localizedRoutes.concat(buildLocalizedRoutes(route, localeCodes))
  }

  if (sortRoutes) {
    try {
      // @ts-ignore
      const { sortRoutes: sortRoutesFn } = require('@nuxt/utils')
      localizedRoutes = sortRoutesFn(localizedRoutes)
    } catch (error) {
      // Ignore
    }
  }

  console.info(JSON.stringify(customPathsMap, null, 2))

  return { localizedRoutes, customPathsMap }
}
