import json
import os

from rocketpy import Environment, Flight, Rocket, SolidMotor

DATA_DIR = "Serializer-export-rockets/v1.5.0/"


def is_empty(value):
    return value is None or value == {} or value == []


with open(os.path.join(DATA_DIR, "parameters.json"), "r") as f:
    params = json.load(f)


# 1. Setup the Environment
env_data = params["environment"]
env = Environment(
    elevation=env_data["elevation"],
    latitude=env_data["latitude"],
    longitude=env_data["longitude"],
)
# Using the standard atmosphere model out of the box
env.set_atmospheric_model(type="standard_atmosphere")

# 2. Setup the Motor
motor_data = params["motors"]
# The thrust source needs an absolute/relative path to the actual file
thrust_source_path = os.path.join(DATA_DIR, "thrust_source.csv")

motor = SolidMotor(
    thrust_source=thrust_source_path,
    dry_mass=motor_data["dry_mass"],
    dry_inertia=tuple(motor_data["dry_inertia"]),
    nozzle_radius=motor_data["nozzle_radius"],
    grain_number=motor_data["grain_number"],
    grain_density=motor_data["grain_density"],
    grain_outer_radius=motor_data["grain_outer_radius"],
    grain_initial_inner_radius=motor_data["grain_initial_inner_radius"],
    grain_initial_height=motor_data["grain_initial_height"],
    grain_separation=motor_data["grain_separation"],
    grains_center_of_mass_position=motor_data["grains_center_of_mass_position"],
    center_of_dry_mass_position=motor_data["center_of_dry_mass_position"],
    nozzle_position=motor_data["nozzle_position"],
    throat_radius=motor_data["throat_radius"],
    coordinate_system_orientation=motor_data["coordinate_system_orientation"],
)

# 3. Setup the Rocket
rocket_data = params["rocket"]
drag_curve_path = os.path.join(DATA_DIR, "drag_curve.csv")

# Clean the drag curve to strictly monotonic Mach numbers
drag_curve_dict = {}
with open(drag_curve_path, "r") as f:
    for line in f:
        # Assumes format "Mach, Cd"
        m, cd = line.strip().split(",")
        # A dictionary naturally overwrites duplicate keys, keeping only 1 value per Mach
        drag_curve_dict[float(m)] = float(cd)

clean_drag_curve = sorted([(m, cd) for m, cd in drag_curve_dict.items()])

rocket = Rocket(
    radius=rocket_data["radius"],
    mass=rocket_data["mass"],
    # The JSON exported [0.001, 0.001, 0.213]. But 0.213 is the transverse inertia and 0.001 is the axial.
    # RocketPy expects (I_11, I_22, I_33) where 11 and 22 are transverse and 33 is axial.
    inertia=(
        max(rocket_data["inertia"]),
        max(rocket_data["inertia"]),
        min(rocket_data["inertia"]),
    ),
    power_off_drag=clean_drag_curve,
    power_on_drag=clean_drag_curve,
    center_of_mass_without_motor=rocket_data["center_of_mass_without_propellant"],
    coordinate_system_orientation=rocket_data["coordinate_system_orientation"],
)
rocket.add_motor(motor, position=motor_data["position"])

# 3.a Add Nosecone (single, flat dict)
nose_data = params["nosecones"]
nose_kind = nose_data["kind"]
if nose_kind == "ellipsoid":
    nose_kind = "elliptical"

rocket.add_nose(
    length=nose_data["length"],
    kind=nose_kind,
    position=nose_data["position"],
    name=nose_data["name"],
    base_radius=nose_data["base_radius"],
)

# 3.b Add Tails (indexed dict, may be empty)
for tail in params.get("tails", {}).values():
    rocket.add_tail(
        top_radius=tail["top_radius"],
        bottom_radius=tail["bottom_radius"],
        length=tail["length"],
        position=tail["position"],
        name=tail.get("name", "Tail"),
    )

# 3.c Add Fins (indexed dicts). The MT1 uses free-form fins; trapezoidal /
# elliptical are handled too in case other rockets use them.
trapezoidal_fins = params.get("trapezoidal_fins", {})
elliptical_fins = params.get("elliptical_fins", {})
freeform_fins = params.get("freeform_fins", {})

for fin in freeform_fins.values():
    rocket.add_free_form_fins(
        n=fin["number"],
        # shape_points come straight from the serializer (OpenRocket finpoints,
        # +x toward the tail — already RocketPy's convention, no transform).
        shape_points=[tuple(pt) for pt in fin["shape_points"]],
        position=fin["position"],
        cant_angle=fin["cant_angle"],
        name=fin["name"],
    )

for fin in trapezoidal_fins.values():
    rocket.add_trapezoidal_fins(
        n=fin["number"],
        root_chord=fin["root_chord"],
        tip_chord=fin["tip_chord"],
        span=fin["span"],
        position=fin["position"],
        cant_angle=fin.get("cant_angle", 0.0),
    )

for fin in elliptical_fins.values():
    rocket.add_elliptical_fins(
        n=fin["number"],
        root_chord=fin["root_chord"],
        span=fin["span"],
        position=fin["position"],
        cant_angle=fin.get("cant_angle", 0.0),
    )

if is_empty(trapezoidal_fins) and is_empty(elliptical_fins) and is_empty(freeform_fins):
    print(
        "[ADVERTENCIA] El export no contiene aletas (fins).\n"
        "             El cohete no tiene momento restaurador: la estabilidad y\n"
        "             los resultados NO son físicamente representativos."
    )

# 3.d Add Parachutes (indexed dict)
for para in params.get("parachutes", {}).values():
    rocket.add_parachute(
        name=para["name"],
        cd_s=para["cds"],
        trigger=para["deploy_event"],
        lag=para["deploy_delay"],
    )

# 3.e Add Rail Buttons (single, flat dict)
rail_data = params.get("rail_buttons")
if rail_data and not is_empty(rail_data):
    rocket.set_rail_buttons(
        upper_button_position=rail_data["upper_position"],
        lower_button_position=rail_data["lower_position"],
        angular_position=rail_data["angular_position"],
    )

# 4. Execute Flight Simulation
flight_data = params["flight"]
flight = Flight(
    rocket=rocket,
    environment=env,
    rail_length=flight_data["rail_length"],
    inclination=flight_data["inclination"],
    heading=flight_data["heading"],
    verbose=True,
)

# Print a summary of the flight simulation
flight.info()
