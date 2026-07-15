// --- PATHFINDING LAYER (SCENERY AGNOSTIC) ---

let activeConnections = [];

/**
 * Updates the active connection graph nodes. Called by Story Manager or Game initialization.
 * @param {Array} connections - Array of connection definitions ({from, to}).
 */
export function setConnections(connections) {
    activeConnections = connections || [];
}

// Get neighbors of a room taking blocked connections into account
export function getNeighbors(room, blockedConnections) {
    let neighbors = [];
    for (let conn of activeConnections) {
        let isBlocked = blockedConnections.includes(`${conn.from}-${conn.to}`) || 
                        blockedConnections.includes(`${conn.to}-${conn.from}`);
        if (isBlocked) continue;

        if (conn.from === room) neighbors.push(conn.to);
        if (conn.to === room) neighbors.push(conn.from);
    }
    return neighbors;
}

// BFS Pathfinding between two rooms
export function findPath(start, goal, blockedConnections) {
    if (start === goal) return [start];
    let queue = [[start]];
    let visited = new Set([start]);

    while (queue.length > 0) {
        let path = queue.shift();
        let current = path[path.length - 1];

        let neighbors = getNeighbors(current, blockedConnections);
        for (let next of neighbors) {
            if (!visited.has(next)) {
                visited.add(next);
                let newPath = [...path, next];
                if (next === goal) return newPath;
                queue.push(newPath);
            }
        }
    }
    return null; // Path blocked
}
