import type { NextConfig } from "next";
import path from "node:path";

/**
 * Large vendored dependency trees that live inside this project directory
 * (the HyperFrames source checkout + its bun/npm install caches).
 *
 * These contain tens of thousands of files and thousands of nested symlinks
 * (each bun package is linked under `node_modules/.bun/<pkg>@<ver>/node_modules/<pkg>`).
 * Webpack's build-dependency context resolution walks *every* file under the
 * project root, so this huge symlinked tree makes the walk overflow and the
 * build fails with `RangeError: Invalid array length`.
 *
 * The project's own code never imports anything from these directories, so we
 * exclude them from webpack's file-system walk.
 */
const vendoredTrees: Array<string | RegExp> = [
  /[\\/]hyperframes[\\/]/, // the HyperFrames checkout
  /[\\/]\.bun[\\/]/, // bun install cache
  /[\\/]\.npm[\\/]/, // npm cache (cacache)
  /[\\/]compositions[\\/]/, // HTML compositions, not part of the Next.js build
];

/** Same as `vendoredTrees`, plus the nested `node_modules` inside them. */
const vendoredNodeModules: Array<string | RegExp> = [...vendoredTrees];

const toArray = (value: unknown): Array<string | RegExp> => {
  if (Array.isArray(value)) return value as Array<string | RegExp>;
  if (typeof value === "string" || value instanceof RegExp) return [value];
  return [];
};

const nextConfig: NextConfig = {
  outputFileTracingRoot: __dirname,

  // The FalkorDB driver (and its @redis/* tree) is CJS with dynamic requires
  // that break under webpack's RSC bundling (`e.BigInt is not a function`).
  // Keep it out of the bundle: route handlers resolve it with native require.
  serverExternalPackages: [
    "falkordb",
    "@redis/client",
    "@redis/bloom",
    "@redis/json",
    "@redis/search",
    "@redis/time-series",
  ],

  webpack: (config) => {
    // --- 1. Keep webpack from walking the vendored trees -----------------
    // `managedPaths` tells webpack these are package-manager directories whose
    // contents are stable, so it hashes/validates them as a single unit instead
    // of walking every nested file and symlink. `unmanagedPaths` excludes them
    // from individual file-level bookkeeping. This is what stops the overflow.
    config.snapshot = {
      ...config.snapshot,
      managedPaths: [...toArray(config.snapshot?.managedPaths), ...vendoredNodeModules],
      unmanagedPaths: [...toArray(config.snapshot?.unmanagedPaths), ...vendoredNodeModules],
      immutablePaths: [...toArray(config.snapshot?.immutablePaths), ...vendoredNodeModules],
    };

    // --- 2. Don't watch them (dev-mode rebuild storms) --------------------
    // NOTE: `watchOptions.ignored` accepts a single glob string (or RegExp).
    config.watchOptions = {
      ...config.watchOptions,
      ignored: "**/{hyperframes,.bun,.npm,compositions}/**",
    };

    // --- 3. Do not follow symlinks inside those trees ---------------------
    // bun's store is almost entirely symlinks; resolving them during the build
    // multiplies the traversal cost. Nothing in this app resolves through them.
    config.resolve.symlinks = false;

    // --- 4. Keep the tsconfig `@/*` path alias ---------------------------
    config.resolve.alias = {
      ...config.resolve.alias,
      "@": path.join(__dirname),
    };

    return config;
  },
};

export default nextConfig;
