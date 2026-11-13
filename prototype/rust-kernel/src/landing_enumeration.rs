use napi::bindgen_prelude::{Float64Array, Uint32Array};
use napi::{Error, Result};
use napi_derive::napi;
use std::sync::Arc;

type Box3 = [f64; 6];
const NONE: u32 = u32::MAX;

#[napi(object)]
pub struct LandingSnapshot {
    pub boxes: Float64Array,
    pub offsets: Uint32Array,
    pub children: Uint32Array,
    pub entry_ids: Uint32Array,
    pub reach_table: Float64Array,
    pub minimum_bin: f64,
    pub gravity: f64,
    pub falling_gravity: f64,
    pub max_jump_height: f64,
    pub max_falling_speed: f64,
    pub apex_time: f64,
    pub max_horizontal_speed: f64,
    pub initial: f64,
    pub deceleration: Option<f64>,
}
#[napi(object)]
pub struct LandingCost {
    pub approach_time: f64,
    pub inset: f64,
    pub radius: f64,
    pub air_speed: f64,
    pub bound_speed: f64,
    pub goal: Vec<f64>,
    pub limit: f64,
}
#[napi(object)]
pub struct LandingQuery {
    pub bounds: Float64Array,
    pub target: Vec<f64>,
    pub anchor: Vec<f64>,
    pub padding: Vec<f64>,
    pub max_horizontal_distance: f64,
    pub rise: f64,
    pub fall: f64,
    pub tolerance: f64,
    pub scale: f64,
    pub cost: Option<LandingCost>,
}
#[napi(object)]
pub struct LandingBatch {
    pub ids: Uint32Array,
    pub done: bool,
}
struct Tree {
    boxes: Vec<Box3>,
    offsets: Vec<u32>,
    children: Vec<u32>,
    entry_ids: Vec<u32>,
    flight: Flight,
}
struct Flight {
    table: Vec<f64>,
    minimum_bin: f64,
    gravity: f64,
    falling_gravity: f64,
    height: f64,
    falling_speed: f64,
    apex: f64,
    cap: f64,
    initial: f64,
    deceleration: Option<f64>,
}
fn invalid() -> Error {
    Error::from_reason("Invalid landing enumeration inputs")
}
// Derived differences can overflow even though snapshot coordinates are finite.
// Keep Math.hypot's Infinity behavior before using the shared V8-order kernel.
fn hypot(x: f64, z: f64) -> f64 {
    if x.is_infinite() || z.is_infinite() {
        f64::INFINITY
    } else {
        super::hypot2(x, z)
    }
}
fn max(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else if a == 0.0 && b == 0.0 {
        if a.is_sign_positive() || b.is_sign_positive() {
            0.0
        } else {
            -0.0
        }
    } else {
        a.max(b)
    }
}
fn min(a: f64, b: f64) -> f64 {
    -max(-a, -b)
}
fn gap(low: f64, high: f64, point: f64) -> f64 {
    max(max(low - point, 0.0), point - high)
}
impl Flight {
    fn reach(&self, drop: f64) -> Result<f64> {
        let index = (drop / 0.25).ceil() - self.minimum_bin;
        if index >= 0.0 && index < self.table.len() as f64 {
            return Ok(self.table[index as usize]);
        }
        // Out-of-table requests use the same phase additions as verticalDuration,
        // then the non-expiring forward-flight family used by flightEnvelope.
        let end_height = -drop;
        let peak = if self.height > 0.0 { self.height } else { 0.0 };
        if end_height > peak {
            return Ok(0.0);
        }
        let mut duration = 0.0;
        if self.height > 0.0 {
            let velocity = (2.0 * self.gravity * self.height).sqrt();
            duration += velocity / self.gravity;
            if self.apex > 0.0 {
                duration += self.apex;
            }
        }
        let distance = peak - end_height;
        let terminal_time = self.falling_speed / self.falling_gravity;
        let terminal_distance = (self.falling_speed * terminal_time) / 2.0;
        if distance > 0.0 {
            if distance <= terminal_distance {
                duration += ((2.0 * distance) / self.falling_gravity).sqrt();
            } else {
                duration += terminal_time;
                duration += (distance - terminal_distance) / self.falling_speed;
            }
        }
        if !duration.is_finite() {
            return Err(Error::from_reason("Non-finite jump model"));
        }
        if duration <= 0.0 {
            return Ok(0.0);
        }
        let Some(acceleration) = self.deceleration.filter(|a| a.is_finite() && *a > 0.0) else {
            return Ok(self.initial * duration);
        };
        if self.initial <= self.cap {
            return Ok(self.initial * duration);
        }
        let braking = min(duration, (self.initial - self.cap) / acceleration);
        Ok(
            self.initial * braking - (acceleration * braking * braking) / 2.0
                + self.cap * (duration - braking),
        )
    }
}
impl LandingQuery {
    fn allows(&self, b: Box3, flight: &Flight) -> Result<bool> {
        if !(b[0] <= self.bounds[3]
            && b[3] >= self.bounds[0]
            && b[1] <= self.bounds[4]
            && b[4] >= self.bounds[1]
            && b[2] <= self.bounds[5]
            && b[5] >= self.bounds[2])
        {
            return Ok(false);
        }
        if let Some(cost) = &self.cost {
            let dx = max(
                max(b[0] - cost.inset - self.anchor[0], 0.0),
                self.anchor[0] - b[3] - cost.inset,
            );
            let dz = max(
                max(b[2] - cost.inset - self.anchor[2], 0.0),
                self.anchor[2] - b[5] - cost.inset,
            );
            let gx = max(
                max(b[0] - cost.inset - cost.goal[0], 0.0),
                cost.goal[0] - b[3] - cost.inset,
            );
            let gz = max(
                max(b[2] - cost.inset - cost.goal[2], 0.0),
                cost.goal[2] - b[5] - cost.inset,
            );
            let within_cost = cost.approach_time
                + max(0.0, hypot(dx, dz) - 2.0 * cost.radius) / cost.air_speed
                + max(0.0, hypot(gx, gz) - cost.radius) / cost.bound_speed
                <= cost.limit + 1e-9;
            if !within_cost {
                return Ok(false);
            }
        }
        let min_x = b[0] - self.padding[0];
        let max_x = b[3] + self.padding[0];
        let min_y = b[1] - self.padding[1];
        let max_y = b[4] + self.padding[1];
        let min_z = b[2] - self.padding[2];
        let max_z = b[5] + self.padding[2];
        let mut scale = self.scale;
        for v in [min_x, max_x, min_y, max_y, min_z, max_z] {
            scale = max(scale, v.abs());
        }
        let epsilon = 32.0 * f64::EPSILON * scale;
        if !epsilon.is_finite() {
            return Ok(true);
        }
        let span = hypot(
            gap(min_x, max_x, self.anchor[0]),
            gap(min_z, max_z, self.anchor[2]),
        );
        if span > self.max_horizontal_distance + epsilon {
            return Ok(false);
        }
        let y = self.anchor[1];
        if max_y < y - self.fall - epsilon || min_y > y + self.rise + epsilon {
            return Ok(false);
        }
        let landing = max(min_y, y - self.fall);
        let drop = y - landing + 2.0 * self.tolerance + epsilon;
        if !drop.is_finite() {
            return Ok(true);
        }
        let reach = flight.reach(drop)?;
        Ok(!reach.is_finite() || span <= reach + epsilon)
    }
    fn cost(&self, b: Box3) -> f64 {
        let mut result = 0.0;
        for axis in 0..3 {
            let distance = gap(b[axis], b[axis + 3], self.target[axis]);
            result += distance * distance;
        }
        result
    }
}
#[derive(Clone, Copy)]
struct Item {
    node: u32,
    cost: f64,
}
// Equal costs intentionally have no ID or insertion-order tiebreaker. These
// comparisons mirror BoundsIndex.nearest, including left-child preference.
fn push(heap: &mut Vec<Item>, value: Item) {
    let mut index = heap.len();
    heap.push(value);
    while index > 0 {
        let parent = (index - 1) >> 1;
        if heap[parent].cost <= value.cost {
            break;
        }
        heap[index] = heap[parent];
        index = parent;
    }
    heap[index] = value;
}
fn pop(heap: &mut Vec<Item>) -> Option<Item> {
    let first = *heap.first()?;
    let last = heap.pop().unwrap();
    if !heap.is_empty() {
        let mut index = 0;
        while index * 2 + 1 < heap.len() {
            let mut child = index * 2 + 1;
            if child + 1 < heap.len() && heap[child + 1].cost < heap[child].cost {
                child += 1;
            }
            if heap[child].cost >= last.cost {
                break;
            }
            heap[index] = heap[child];
            index = child;
        }
        heap[index] = last;
    }
    Some(first)
}

#[napi]
pub struct LandingEnumerationIndex {
    tree: Arc<Tree>,
}
#[napi]
impl LandingEnumerationIndex {
    #[napi(constructor)]
    pub fn new(snapshot: LandingSnapshot) -> Result<Self> {
        let count = snapshot.entry_ids.len();
        if count == 0
            || snapshot.boxes.len() != count * 6
            || snapshot.offsets.len() != count + 1
            || snapshot.offsets[0] != 0
            || snapshot.offsets[count] as usize != snapshot.children.len()
            || snapshot.offsets.windows(2).any(|w| w[0] > w[1])
            || snapshot.children.iter().any(|&c| c as usize >= count)
        {
            return Err(invalid());
        }
        let boxes = snapshot.boxes.as_chunks::<6>().0.to_vec();
        Ok(Self {
            tree: Arc::new(Tree {
                boxes,
                offsets: snapshot.offsets.to_vec(),
                children: snapshot.children.to_vec(),
                entry_ids: snapshot.entry_ids.to_vec(),
                flight: Flight {
                    table: snapshot.reach_table.to_vec(),
                    minimum_bin: snapshot.minimum_bin,
                    gravity: snapshot.gravity,
                    falling_gravity: snapshot.falling_gravity,
                    height: snapshot.max_jump_height,
                    falling_speed: snapshot.max_falling_speed,
                    apex: snapshot.apex_time,
                    cap: snapshot.max_horizontal_speed,
                    initial: snapshot.initial,
                    deceleration: snapshot.deceleration,
                },
            }),
        })
    }
    #[napi]
    pub fn cursor(&self, query: LandingQuery) -> Result<LandingEnumerationCursor> {
        if query.bounds.len() != 6
            || query.target.len() != 3
            || query.anchor.len() != 3
            || query.padding.len() != 3
            || query.cost.as_ref().is_some_and(|c| c.goal.len() != 3)
        {
            return Err(invalid());
        }
        let mut result = LandingEnumerationCursor {
            tree: Some(Arc::clone(&self.tree)),
            query,
            heap: Vec::new(),
        };
        result.enqueue(0)?;
        Ok(result)
    }
}
#[napi]
pub struct LandingEnumerationCursor {
    tree: Option<Arc<Tree>>,
    query: LandingQuery,
    heap: Vec<Item>,
}
impl LandingEnumerationCursor {
    fn enqueue(&mut self, node: u32) -> Result<()> {
        let tree = self.tree.as_ref().unwrap();
        let bounds = tree.boxes[node as usize];
        if self.query.allows(bounds, &tree.flight)? {
            push(
                &mut self.heap,
                Item {
                    node,
                    cost: self.query.cost(bounds),
                },
            );
        }
        Ok(())
    }
}
#[napi]
impl LandingEnumerationCursor {
    #[napi]
    pub fn read_batch(&mut self, limit: u32) -> Result<LandingBatch> {
        if limit == 0 {
            return Err(invalid());
        }
        let mut ids = Vec::new();
        while ids.len() < limit as usize {
            let Some(item) = pop(&mut self.heap) else {
                break;
            };
            let tree = self.tree.as_ref().unwrap();
            let node = item.node as usize;
            if tree.entry_ids[node] != NONE {
                ids.push(tree.entry_ids[node]);
            } else {
                let begin = tree.offsets[node] as usize;
                let end = tree.offsets[node + 1] as usize;
                for offset in begin..end {
                    let child = self.tree.as_ref().unwrap().children[offset];
                    self.enqueue(child)?;
                }
            }
        }
        Ok(LandingBatch {
            ids: ids.into(),
            done: self.heap.is_empty(),
        })
    }
    #[napi]
    pub fn close(&mut self) {
        self.heap = Vec::new();
        self.tree = None;
    }
}
