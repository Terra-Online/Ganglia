export type Vec3 = [number, number, number];
export interface Node { id: string; position: Vec3 }
export interface Edge { from: string; to: string; cost: number; state: 'open' | 'closed' | 'unknown'; points: Vec3[] }
export interface Graph { nodes: Node[]; edges: Edge[] }
export type Route = { status: 'complete'; start: string; cost: number; length: number; points: Vec3[] } | { status: 'unmapped' | 'no-verified-route' };
export interface Wall { min: Vec3; max: Vec3; state: 'active' | 'inactive' | 'unknown'; padding?: number; points?: [number, number][] }
export function route(graph: Graph, start: string, goal: string, constraints?: { walls: Wall[]; profile: { radius: number; height: number } }): Route;
export function sampleRoute(points: Vec3[], meters: number): Vec3;
export function blockedByWalls(start: Vec3, end: Vec3, walls: Wall[], profile: { radius: number; height: number }): boolean;
export interface Surface { id: string; vertices: Vec3[]; portals?: number[] }
export function surfaceGraph(surfaces: Surface[], options: { speed: number }): Graph;

export interface Arrival { id: string; node: string; cost: number; state: 'available' | 'locked' | 'unknown' }
export function routeFrom(graph: Graph, starts: Arrival[], goal: string, constraints?: { walls: Wall[]; profile: { radius: number; height: number } }): Route;
export function projectPoint(surfaces: Surface[], position: Vec3, options: { maxVertical: number }): { surface: string; position: Vec3 } | null;
export interface GroundArrival { id: string; position: Vec3; cost: number; state: Arrival['state'] }
export interface GroundOptions { speed: number; maxVertical: number; walls: Wall[]; profile: { radius: number; height: number } }
export function planGroundRoute(surfaces: Surface[], starts: GroundArrival[], goal: Vec3, options: GroundOptions): Route;
