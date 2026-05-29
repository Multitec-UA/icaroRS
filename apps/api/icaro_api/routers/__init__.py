"""icaro_api routers — HTTP delivery surface.

Each router is a thin adapter: parse → call icaro or services → shape HTTP.
NO business logic lives here. Domain rules live in packages/icaro.
"""
