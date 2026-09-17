# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

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
