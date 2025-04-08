# Ganglia

**Ganglia** is a progressive path optimization engine designed exclusively for the [Open Endfield Map](https://github.com/your-org/open-endfield-map), an unofficial web map project for **Arknights: Endfield**.

It calculates traversal routes between interactable map nodes on-demand, based on user requests, while adhering to game-specific map constraints. Ganglia returns a fast, approximate path initially and refines the path incrementally as more users request the same routes.

Built in **C++** and compiled to **WebAssembly**, Ganglia operates directly in the browser or server, optimized for quick and progressive path generation.

---

## 🌐 Features

- ⚡ **Fast initial response**: Uses Nearest Neighbor + 2-opt for quick, approximate pathfinding.
- 🔁 **Progressive refinement**: As more users request paths, the algorithm incrementally optimizes the route.
- 🧠 **Shared cache**: Path optimization is progressively improved and shared across users.
- 🗺️ **Flexible input**: Accepts JSON-defined map nodes.
- 🚀 **WebAssembly powered**: Runs in the browser or server using WASM, providing optimal performance.

---

## 🎯 Purpose

**Ganglia** is developed **specifically for the Open Endfield Map project** and is **not intended for general-purpose or third-party use**.

In the context of Open Endfield Map, Ganglia handles:
- On-demand pathfinding for interactable points on the map.
- Initial approximate paths based on Nearest Neighbor + 2-opt.
- Incremental path improvement as additional users request the same routes.

---

## 🔧 Architecture Overview

1. **Initial Path**: Generated on demand using Nearest Neighbor + 2-opt (quick but approximate).
2. **Dynamic Cache**: Path data is cached and reused for future requests.
3. **User-driven Refinement**: Paths are progressively improved with each subsequent request.
4. **Route Finalization**: Once a path has been sufficiently refined, it becomes a stable, optimized route.

---

## 📦 Integration

- **Input**: JSON map + list of interactable nodes.
- **Output**: Ordered node sequence and full path segments for map rendering.
- **Usage**: Exposed via C++ interface or WASM JavaScript bindings.

---

## 🧪 Status

> Ganglia is under active development for Open Endfield Map.
> Not intended for reuse outside this context.
> Contributions welcome within the scope of the project.
