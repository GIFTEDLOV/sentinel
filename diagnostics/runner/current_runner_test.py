# { "Depends": "py-genlayer:1zr6nqk597d97kg0dyxg0shhrykx5v02zjgnyrajapy4wlqvfvwh" }

import genlayer as _genlayer

try:
    _contract = _genlayer.contract
    _view = _genlayer.public.view
except AttributeError:
    from genlayer import gl as _legacy_gl

    _contract = _legacy_gl
    _view = _legacy_gl.public.view


class RunnerTest(_contract.Contract):
    value: str

    def __init__(self):
        self.value = "runner-ok"

    @_view
    def get_value(self) -> str:
        return self.value
