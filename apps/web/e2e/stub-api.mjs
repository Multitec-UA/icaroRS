// @ts-check
/**
 * Deterministic stub of the icaro API for the visual-regression suite.
 *
 * Plain Node (`http`, `zlib`), no dependencies and no build step, so it runs
 * the same on a laptop, inside the Playwright Docker image and in CI:
 *
 *   node e2e/stub-api.mjs            # listens on 127.0.0.1:4010
 *   STUB_API_PORT=4020 node e2e/stub-api.mjs
 *
 * It implements exactly the paths the web calls (lib/api.ts and
 * lib/server-api.ts). Shapes follow apps/web/openapi/schema.json; scalar keys
 * and plot stems follow apps/api/icaro_api/serialize.py. Every value is fixed:
 * same request, same bytes, on every run.
 *
 * Test switches:
 * - Cookie `e2e-anon=1`: `GET /api/auth/me` answers 401, so the app shows
 *   the login screen.
 * - `GET /healthz`: readiness probe used by playwright.config.ts.
 * - `GET /tile.png`: a flat 256x256 PNG the tests route map tiles to.
 */

import http from "node:http";
import zlib from "node:zlib";

const PORT = Number(process.env.STUB_API_PORT ?? 4010);
const HOST = process.env.STUB_API_HOST ?? "127.0.0.1";
/** Delay before answering convert and simulate, so busy states are visible. */
const SLOW_MS = 300;

// ---------------------------------------------------------------------------
// PNG encoder (solid colour, RGB, no filtering) — enough for tiles and plots.
// ---------------------------------------------------------------------------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

/** @param {Buffer} buf */
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** @param {string} type @param {Buffer} data */
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/**
 * A solid-colour PNG with an optional darker horizontal band, so plot
 * thumbnails are recognisable as images rather than empty boxes.
 * @param {number} width @param {number} height @param {[number, number, number]} rgb
 * @param {[number, number, number]} [band]
 */
function solidPng(width, height, rgb, band) {
  const row = Buffer.alloc(1 + width * 3);
  const bandRow = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) {
    row.set(rgb, 1 + x * 3);
    bandRow.set(band ?? rgb, 1 + x * 3);
  }
  const rows = [];
  for (let y = 0; y < height; y++) {
    const inBand = band && y > height * 0.45 && y < height * 0.55;
    rows.push(inBand ? bandRow : row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const TILE_PNG = solidPng(256, 256, [222, 226, 230]);
const PLOT_PNG = solidPng(640, 400, [246, 247, 249], [96, 125, 180]);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ORG_ID = "org-multitec";
const USER = "pilot@multitec.test";

const IDENTITY = { user_id: "user-pilot", org_id: ORG_ID, email: USER };

const PLOT_STEMS = [
  "trajectory_3d",
  "linear_kinematics",
  "flight_path_angle",
  "energy",
  "aerodynamic_forces",
  "stability_control",
  "angular_kinematics",
  "attitude",
  "fluid_mechanics",
  "pressure_altitude",
  "rail_bending_moments",
  "rail_forces",
];

const ROCKETS = [
  { rocket_id: "rkt-icarus-mk2", name: "Icarus Mk II", created_at: "2026-09-14T09:30:00Z", created_by: USER },
  { rocket_id: "rkt-dedalo", name: "Dédalo", created_at: "2026-06-02T16:05:00Z", created_by: USER },
];

/**
 * A manifest shaped like the `parameters.json` rocketserializer writes
 * (packages/rocketserializer/rocketserializer/ork_extractor.py): rocket name
 * under `id`, mass (kg, at burnout) and radius (m) under `rocket`, one solid
 * motor's grain geometry under `motors`, parachutes keyed "0", "1"…, the rail
 * already converted to RocketPy's inclination under `flight`, and
 * OpenRocket's own results under `stored_results`. `name` mirrors what the
 * API reads to name a converted rocket.
 *
 * `enriched` adds the optional keys newer serializers write: the file's
 * provenance under `id`, the motor's identity under `motors.identity` and
 * the reference simulation's provenance under `stored_results`. Without it
 * the manifest is a legacy one (the Dédalo file keeps that shape).
 *
 * @param {string} name @param {number} mass @param {number} radius
 * @param {{apogee: number, speed: number, time: number}} stored
 * @param {{simulation: string, status: string, selection: string} | null} [enriched]
 */
function manifest(name, mass, radius, stored, enriched = null) {
  return {
    name,
    id: {
      rocket_name: name,
      comment: null,
      designer: null,
      ...(enriched && { ork_format_version: "1.10", creator: "OpenRocket 24.12", serializer_version: "1.0.0" }),
    },
    rocket: { mass, radius, inertia: [6.32, 6.32, 0.034], coordinate_system_orientation: "nose_to_tail" },
    motors: {
      grain_density: 1815.0,
      grain_initial_inner_radius: 0.0145,
      grain_outer_radius: 0.029,
      grain_initial_height: 0.398,
      grain_number: 1,
      dry_mass: 0,
      coordinate_system_orientation: "nozzle_to_combustion_chamber",
      ...(enriched && {
        identity: {
          designation: "232H123-14A",
          manufacturer: "Cesaroni Technology",
          ork_motor_type: "reload",
          config_id: "cfg-icarus-h123",
          motor_count: 1,
          impulse_class: "H",
          total_impulse_newton_seconds: 232,
          impulse_check: "ok",
          burn_time_seconds: 1.94,
        },
      }),
    },
    parachutes: {
      0: { name: "Drogue", cd: 1.5, cds: 0.42, deploy_event: "apogee", deploy_delay: 1.0, deploy_altitude: null },
      1: { name: "Main", cd: 2.2, cds: 2.1, deploy_event: "altitude", deploy_delay: 0.0, deploy_altitude: 300 },
    },
    flight: { rail_length: 5.2, inclination: 85, heading: 90 },
    stored_results: {
      max_altitude: stored.apogee,
      max_velocity: stored.speed,
      max_acceleration: 98.4,
      max_mach: 0.86,
      time_to_apogee: 19.7,
      flight_time: stored.time,
      ground_hit_velocity: 6.1,
      launch_rod_velocity: 24.3,
      max_stability_margin: 2.71,
      min_stability_margin: 1.62,
      burnout_stability_margin: 2.05,
      max_thrust: 1712.0,
      ...(enriched && {
        simulation_name: enriched.simulation,
        status: enriched.status,
        config_id: "cfg-icarus-h123",
        selection: enriched.selection,
      }),
    },
  };
}

const EXPORTS = [
  {
    export_id: "exp-icarus-v3",
    rocket_id: "rkt-icarus-mk2",
    name: "Icarus Mk II",
    ork_filename: "icarus-mk2-v3.ork",
    created_at: "2026-10-20T11:15:00Z",
    manifest: manifest("Icarus Mk II", 7.84, 0.0635, { apogee: 1832.4, speed: 291.7, time: 128.3 }, {
      simulation: "Simulation 1",
      status: "uptodate",
      selection: "uptodate_default",
    }),
  },
  {
    export_id: "exp-icarus-v2",
    rocket_id: "rkt-icarus-mk2",
    name: "Icarus Mk II",
    ork_filename: "icarus-mk2-v2.ork",
    created_at: "2026-09-14T09:30:00Z",
    manifest: manifest("Icarus Mk II", 8.12, 0.0635, { apogee: 1741.0, speed: 280.2, time: 124.9 }, {
      simulation: "Pre-flight check",
      status: "outdated",
      selection: "fallback",
    }),
  },
  {
    export_id: "exp-dedalo-2026",
    rocket_id: "rkt-dedalo",
    name: "Dédalo",
    ork_filename: "dedalo-2026.ork",
    created_at: "2026-06-02T16:05:00Z",
    manifest: manifest("Dédalo", 5.31, 0.0508, { apogee: 1288.6, speed: 238.4, time: 101.2 }),
  },
].map((e) => ({
  ...e,
  created_by: USER,
  export_prefix: `orgs/${ORG_ID}/exports/${e.export_id}/`,
  gcs_ref: `gs://icaro-e2e/orgs/${ORG_ID}/exports/${e.export_id}/`,
  has_source_ork: true,
}));

/**
 * The 16 scalars the core serialises (serialize.py::_SCALAR_ATTR_MAP).
 * @param {number} apogee @param {number} speed @param {number} mach
 * @param {number} margin @param {number} tFinal
 */
function scalars(apogee, speed, mach, margin, tFinal) {
  const apogeeTime = Math.round((apogee / 96) * 100) / 100;
  return {
    apogee_m: apogee,
    apogee_time_s: apogeeTime,
    apogee_x_m: 112.4,
    apogee_y_m: -38.9,
    flight_time_s: tFinal,
    impact_x_m: 412.7,
    impact_y_m: -151.3,
    impact_velocity_ms: 5.42,
    max_velocity_ms: speed,
    max_velocity_time_s: 2.61,
    max_mach: mach,
    max_acceleration_ms2: 148.9,
    max_acceleration_time_s: 0.18,
    rail_departure_velocity_ms: 27.6,
    rail_departure_time_s: 0.41,
    rail_departure_stability_margin: margin,
  };
}

/**
 * @param {number} lat @param {number} lon @param {string} model
 * @param {{year: number, month: number, day: number, hour: number}} date
 * @param {number} railLength
 */
function scenario(lat, lon, model, date, railLength) {
  return {
    name: "workbench",
    site: { latitude: lat, longitude: lon, elevation: 42 },
    date,
    atmosphere: { model, fallback: "standard_atmosphere", file: model === "forecast" ? "GFS" : null, station: null },
    rail: { length: railLength, inclination: 85, heading: 90 },
    uncertainty: {},
  };
}

const RUNS = [
  {
    simulation_id: "run-icarus-0004",
    export_id: "exp-icarus-v3",
    created_at: "2026-10-29T17:42:00Z",
    scenario: scenario(38.2655, -0.6981, "forecast", { year: 2026, month: 11, day: 7, hour: 10 }, 5.2),
    scalars: scalars(1812.6, 289.4, 0.86, 2.14, 126.8),
    warnings: [
      "Forecast unavailable for the requested hour; fell back to the standard atmosphere.",
      "Rail departure velocity is below 30 m/s; the rocket may weathercock in strong wind.",
    ],
  },
  {
    simulation_id: "run-icarus-0003",
    export_id: "exp-icarus-v3",
    created_at: "2026-10-24T12:08:00Z",
    scenario: scenario(38.2655, -0.6981, "standard_atmosphere", { year: 2026, month: 11, day: 7, hour: 10 }, 5.2),
    scalars: scalars(1796.1, 287.9, 0.85, 2.11, 125.4),
    warnings: [],
  },
  {
    simulation_id: "run-icarus-0002",
    export_id: "exp-icarus-v2",
    created_at: "2026-09-18T08:55:00Z",
    scenario: scenario(38.2655, -0.6981, "standard_atmosphere", { year: 2026, month: 9, day: 20, hour: 9 }, 6.0),
    scalars: scalars(1724.3, 279.0, 0.82, 1.97, 121.9),
    warnings: [],
  },
  {
    simulation_id: "run-dedalo-0001",
    export_id: "exp-dedalo-2026",
    created_at: "2026-06-05T10:20:00Z",
    scenario: scenario(40.4168, -3.7038, "standard_atmosphere", { year: 2026, month: 6, day: 6, hour: 11 }, 4.0),
    scalars: scalars(1281.9, 236.5, 0.7, 2.32, 99.6),
    warnings: [],
  },
].map((run) => {
  const exp = EXPORTS.find((e) => e.export_id === run.export_id);
  if (!exp) throw new Error(`fixture run ${run.simulation_id} names an unknown export`);
  return {
    ...run,
    rocket_id: exp.rocket_id,
    name: exp.name,
    ork_filename: exp.ork_filename,
    created_by: USER,
    status: /** @type {const} */ ("done"),
    result_prefix: `orgs/${ORG_ID}/results/${run.simulation_id}/`,
    // The API's shape: file names with ".png" (routers/simulate.py derives them from the plot URLs).
    plot_names: PLOT_STEMS.map((stem) => `${stem}.png`),
    has_series: true,
  };
});

/** The run `POST /api/simulate` answers with: the newest Icarus run. */
const SIMULATED_RUN = RUNS[0];

/** @param {(typeof RUNS)[number]} run */
function simulateResult(run) {
  return {
    run_id: run.simulation_id,
    scalars: run.scalars,
    plot_urls: PLOT_STEMS.map((stem) => `/api/results/${run.simulation_id}/plots/${stem}.png`),
    warnings: run.warnings,
  };
}

/**
 * A plausible 200-sample flight: powered ascent, coast to apogee, drogue
 * descent, main chute at 300 m. Rounded so the JSON is byte-stable.
 * @param {(typeof RUNS)[number]} run
 */
function series(run) {
  const apogee = run.scalars.apogee_m;
  const ta = run.scalars.apogee_time_s;
  const tf = run.scalars.flight_time_s;
  const vmax = run.scalars.max_velocity_ms;
  const n = 200;
  const r = (/** @type {number} */ v) => Math.round(v * 1000) / 1000;
  /** @type {number[]} */ const t = [];
  /** @type {number[]} */ const altitude = [];
  /** @type {number[]} */ const speed = [];
  /** @type {number[]} */ const acceleration = [];
  /** @type {number[]} */ const mach = [];
  /** @type {number[][]} */ const path3d = [];
  // Descent: drogue at ~22 m/s down to 300 m, then main at ~5.4 m/s.
  const mainAlt = 300;
  const tMain = ta + (apogee - mainAlt) / 22;
  for (let i = 0; i < n; i++) {
    const ti = (tf * i) / (n - 1);
    let alt;
    let v;
    let a;
    if (ti <= ta) {
      const u = (ti - ta) / ta;
      alt = apogee * (1 - u * u);
      v = ti < 2.6 ? (vmax * ti) / 2.6 : vmax * (1 - (ti - 2.6) / (ta - 2.6));
      a = ti < 2.65 ? 112 : -9.81 - 0.0006 * v * v;
    } else if (ti <= tMain) {
      alt = apogee - 22 * (ti - ta);
      v = 22;
      a = 0;
    } else {
      alt = Math.max(0, mainAlt - ((tf - tMain) > 0 ? (mainAlt * (ti - tMain)) / (tf - tMain) : 0));
      v = 5.4;
      a = 0;
    }
    const frac = ti / tf;
    t.push(r(ti));
    altitude.push(r(alt));
    speed.push(r(Math.max(0, v)));
    acceleration.push(r(a));
    mach.push(r(Math.max(0, v) / 340.3));
    path3d.push([r(run.scalars.impact_x_m * frac), r(run.scalars.impact_y_m * frac), r(alt)]);
  }
  return { t, altitude, speed, acceleration, mach, path3d };
}

const SCENARIO_TEMPLATE = {
  name: "unnamed_scenario",
  site: { latitude: 38.2655, longitude: -0.6981, elevation: null },
  date: null,
  atmosphere: { model: "standard_atmosphere", fallback: "standard_atmosphere", file: null, station: null },
  rail: null,
  uncertainty: null,
  uncertainty_presets: {
    Typical: {
      mass: { std: 0.02, kind: "relative" },
      inclination: { std: 1.0, kind: "absolute" },
      heading: { std: 2.0, kind: "absolute" },
    },
    Conservative: {
      mass: { std: 0.05, kind: "relative" },
      inclination: { std: 2.0, kind: "absolute" },
      heading: { std: 5.0, kind: "absolute" },
    },
    None: {},
  },
};

// ---------------------------------------------------------------------------
// HTTP plumbing
// ---------------------------------------------------------------------------

/** @param {http.ServerResponse} res @param {number} status @param {unknown} body */
function json(res, status, body) {
  const payload = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": payload.length,
    "cache-control": "no-store",
  });
  res.end(payload);
}

/** @param {http.ServerResponse} res @param {Buffer} png */
function png(res, png) {
  res.writeHead(200, { "content-type": "image/png", "content-length": png.length, "cache-control": "no-store" });
  res.end(png);
}

/** @param {http.IncomingMessage} req @returns {Promise<Buffer>} */
function readBody(req) {
  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */ const parts = [];
    req.on("data", (c) => parts.push(c));
    req.on("end", () => resolve(Buffer.concat(parts)));
    req.on("error", reject);
  });
}

const delay = (/** @type {number} */ ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** @param {http.IncomingMessage} req */
function isAnonymous(req) {
  return /(?:^|;\s*)e2e-anon=1(?:;|$)/.test(req.headers.cookie ?? "");
}

const notFound = (/** @type {http.ServerResponse} */ res) => json(res, 404, { detail: "Not found" });

/** @param {(typeof EXPORTS)[number]} e */
function exportSummary(e) {
  return Object.fromEntries(Object.entries(e).filter(([key]) => key !== "manifest"));
}

/** @param {http.IncomingMessage} req @param {http.ServerResponse} res */
async function handle(req, res) {
  const url = new URL(req.url ?? "/", `http://${HOST}`);
  const path = url.pathname;
  const method = req.method ?? "GET";
  let m;

  if (path === "/healthz") return json(res, 200, { ok: true });
  if (path === "/tile.png") return png(res, TILE_PNG);

  // Auth
  if (path === "/api/auth/me" && method === "GET") {
    return isAnonymous(req) ? json(res, 401, { detail: "Not authenticated" }) : json(res, 200, IDENTITY);
  }
  if (path === "/api/auth/session" && method === "POST") {
    await readBody(req);
    res.writeHead(204, { "set-cookie": "icaro-session=e2e; Path=/; HttpOnly; SameSite=Lax" });
    return res.end();
  }
  if (path === "/api/auth/logout" && method === "POST") {
    res.writeHead(204);
    return res.end();
  }
  if (isAnonymous(req)) return json(res, 401, { detail: "Not authenticated" });

  // Rockets and exports
  if (path === "/api/rockets" && method === "GET") return json(res, 200, ROCKETS);
  if ((m = path.match(/^\/api\/rockets\/([^/]+)$/)) && method === "GET") {
    const rocket = ROCKETS.find((r) => r.rocket_id === decodeURIComponent(m[1]));
    if (!rocket) return notFound(res);
    const exports = EXPORTS.filter((e) => e.rocket_id === rocket.rocket_id).map(exportSummary);
    return json(res, 200, { ...rocket, exports });
  }
  if ((m = path.match(/^\/api\/exports\/([^/]+)$/)) && method === "GET") {
    const exp = EXPORTS.find((e) => e.export_id === decodeURIComponent(m[1]));
    return exp ? json(res, 200, exp) : notFound(res);
  }

  // Convert: multipart; attaches to `rocket_id` when the form names one.
  if (path === "/api/convert" && method === "POST") {
    const body = (await readBody(req)).toString("latin1");
    const rocketField = body.match(/name="rocket_id"\r\n\r\n([^\r\n]+)/);
    await delay(SLOW_MS);
    const target = rocketField ? rocketField[1] : "rkt-icarus-mk2";
    const exp = EXPORTS.find((e) => e.rocket_id === target) ?? EXPORTS[0];
    return json(res, 200, { export_id: exp.export_id, rocket_id: exp.rocket_id, manifest: exp.manifest });
  }

  // Simulate
  if (path === "/api/simulate" && method === "POST") {
    await readBody(req);
    await delay(SLOW_MS);
    return json(res, 200, simulateResult(SIMULATED_RUN));
  }

  // History
  if (path === "/api/history" && method === "GET") {
    const rocketId = url.searchParams.get("rocket_id");
    const limit = Number(url.searchParams.get("limit") ?? 20);
    const rows = RUNS.filter((r) => !rocketId || r.rocket_id === rocketId).slice(0, limit);
    return json(res, 200, rows);
  }
  if ((m = path.match(/^\/api\/history\/([^/]+)$/)) && method === "GET") {
    const run = RUNS.find((r) => r.simulation_id === decodeURIComponent(m[1]));
    return run ? json(res, 200, run) : notFound(res);
  }

  // Results
  if ((m = path.match(/^\/api\/results\/([^/]+)(\/series|\/plots\/([^/]+)\.png)?$/)) && method === "GET") {
    const run = RUNS.find((r) => r.simulation_id === decodeURIComponent(m[1]));
    if (!run) return notFound(res);
    if (m[2] === "/series") return json(res, 200, series(run));
    if (m[3] !== undefined) return PLOT_STEMS.includes(m[3]) ? png(res, PLOT_PNG) : notFound(res);
    return json(res, 200, { run_id: run.simulation_id, status: "done", result: simulateResult(run) });
  }

  // Scenario helpers
  if (path === "/api/scenario/template" && method === "GET") return json(res, 200, SCENARIO_TEMPLATE);
  if (path === "/api/scenario/validate" && method === "POST") {
    const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
    return json(res, 200, body);
  }
  if (path === "/api/atmosphere/suggest" && method === "GET") {
    return json(res, 200, {
      model: "forecast",
      reason: "The launch date is within the 16-day GFS forecast window.",
      within_gfs_window: true,
      needs_internet: true,
    });
  }
  if (path === "/api/elevation" && method === "GET") return json(res, 200, { elevation: 42, source: "dem" });

  return notFound(res);
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error("[stub-api]", err);
    if (!res.headersSent) json(res, 500, { detail: "stub failure" });
    else res.end();
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[stub-api] listening on http://${HOST}:${PORT}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
