import type { RouteQuery, Vec3 } from '@opendfieldmap/ganglia';

type Pair = { id: string; from: Vec3; to: Vec3 };
const spanPairs: Pair[] = [
  {
    id: 'map02-long-01',
    from: [1510.4666423797607, 538.6051940917969, 1442.566642443339],
    to: [-1246.6333576838176, 242.9451700846354, -1992.166690826416],
  },
  {
    id: 'map02-long-02',
    from: [-1949.100024541219, 226.2763468424479, -1228.733357111613],
    to: [1021.8333702087402, 321.43731689453125, 1474.833308537801],
  },
  {
    id: 'map02-long-03',
    from: [-1614.4666906992595, 200.02862548828125, -1535.166691462199],
    to: [1330.1499757766724, 464.4480285644531, 1023.8500366210938],
  },
  {
    id: 'map02-long-04',
    from: [-373.8999942143758, 211.22318522135416, 1529.1666431427002],
    to: [477.20000616709393, 221.71966552734375, -2045.8666915893555],
  },
  {
    id: 'map02-long-05',
    from: [-16.86666742960612, 292.54551188151044, -2006.066691716512],
    to: [34.86666742960612, 151.1573689778646, 1556.8333086967468],
  },
];
const detourPairs: Pair[] = [
  {
    id: 'map02-connected-1',
    from: [-700.1000245412191, 242.22498575846353, -47.20000171661377],
    to: [-1498.3000240325928, 350.1099853515625, -114.52500176429749],
  },
  {
    id: 'map02-connected-2',
    from: [-892.5750246047974, 248.66384887695312, 157.60000604391098],
    to: [-766.6666914621989, 250.1333211263021, 205.166672706604],
  },
];

function routeCase(id: string, from: Vec3, goal: Vec3) {
  const query: RouteQuery = {
    starts: [{ id: 'player', position: from, state: 'available', cost: 0 }],
    goal,
  };
  return { id, query, horizontalDistance: Math.hypot(from[0] - goal[0], from[2] - goal[2]) };
}

function bothDirections(pairs: Pair[]) {
  // Directional drops and layered ground make the reverse journey a distinct problem.
  return pairs.flatMap(({ id, from, to }) => [
    routeCase(`${id}-forward`, from, to),
    routeCase(`${id}-reverse`, to, from),
  ]);
}

export const maximumSpanCases = bothDirections(spanPairs);
export const connectedLongCases = bothDirections(detourPairs);
export const cases = [...maximumSpanCases, ...connectedLongCases];
