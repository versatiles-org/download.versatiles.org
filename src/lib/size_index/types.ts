/**
 * Shared shape of the `*.index.json` size indices.
 *
 * Kept in its own module because it straddles the server/client boundary:
 * `./build.ts` (pipeline, pulls in `@versatiles/container`) writes this shape and
 * `./estimate.ts` (browser) reads it. Importing the types from `build.ts` would
 * risk dragging the container library into the client bundle.
 */

/**
 * A quadtree node: either a mean tile size in bytes (leaf), or four children in
 * NW, NE, SW, SE order.
 */
export type QuadNode = number | [QuadNode, QuadNode, QuadNode, QuadNode];

/** One quadtree per zoom level, keyed by the zoom level as a string. */
export interface SizeIndex {
	levels: Record<string, QuadNode>;
}
