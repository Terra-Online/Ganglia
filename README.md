# Ganglia

**Ganglia** is a progressive path optimization engine designed exclusively for the [Open Endfield Map](https://github.com/Terra-Online/Atlos), an unofficial web map project for **Arknights: Endfield**.

It computes traversal routes across interactable in-game points, under game-specific map constraints. Ganglia delivers fast initial results and gradually improves them using background optimization.

Built in **C++** and compiled to **WebAssembly**, it is optimized for use directly in the browser.

---

## 🌐 Features

- ⚡ **Fast first response**: Nearest Neighbor + 2-opt for instant usability.
- 🔁 **Progressive refinement**: Simulated Annealing in background to improve route quality over time.
- 🧠 **Shared caching**: All users benefit from shared optimization states.
- 🗺️ **Flexible point input**: Accepts JSON-defined map nodes.
- 🚀 **WebAssembly powered**: Runs client-side in browser or server-side via WASM.

---

## 🎯 Purpose

This module is built **specifically for the Open Endfield Map project** and is currently not intended for general-purpose or third-party use.

If you are a contributor to Open Endfield Map, this engine handles:
- Optimized traversal planning for interactable map nodes
- Caching and progressive improvement of multi-target paths
- Integration with in-game-style A* navigation

---

## 🔧 Architecture Overview

1. **Initial Route**: Generated using Nearest Neighbor + 2-opt (very fast).
2. **On-Demand Caching**: Route data stored and reused by future requests.
3. **Background Optimization**: Simulated Annealing used in time-limited steps.
4. **Route Finalization**: Frozen once no longer improving.

---

## 📦 Integration

- **Input**: JSON map + list of interactable nodes.
- **Output**: Ordered node list and path segments for rendering.
- **Usage**: Via C++ interface or WASM JavaScript bindings.

---

## 🧪 Status

> Ganglia is under active development for Open Endfield Map.  
> Not intended for reuse outside this context.  
> Contributions welcome within the scope of the project.