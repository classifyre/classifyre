/**
 * Placing new items next to what they connect to (PRD §8.9). The algorithm is
 * shared with the API, which places items for the MCP arrange tools, so a
 * board placed from an agent and one placed in the browser grow the same way.
 */
export { placeNearNeighbours, type PlaceRequest } from "@workspace/schemas/case-board";
