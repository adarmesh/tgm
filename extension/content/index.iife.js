(function () {
    "use strict";
    var g = function (e, d, n, s) {
        function l(r) {
            return r instanceof n ? r : new n(function (c) {
                c(r)
            })
        }
        return new (n || (n = Promise))(function (r, c) {
            function u(t) {
                try {
                    o(s.next(t))
                } catch (a) {
                    c(a)
                }
            }

            function f(t) {
                try {
                    o(s.throw(t))
                } catch (a) {
                    c(a)
                }
            }

            function o(t) {
                t.done ? r(t.value) : l(t.value).then(u, f)
            }
            o((s = s.apply(e, d || [])).next())
        })
    },
        h;
    (function (e) {
        e.Local = "local", e.Sync = "sync", e.Managed = "managed", e.Session = "session"
    })(h || (h = {}));
    var m;
    (function (e) {
        e.ExtensionPagesOnly = "TRUSTED_CONTEXTS", e.ExtensionPagesAndContentScripts = "TRUSTED_AND_UNTRUSTED_CONTEXTS"
    })(m || (m = {}));

    function w(e, d) {
        return g(this, void 0, void 0, function* () {
            function n(l) {
                return typeof l == "function"
            }

            function s(l) {
                return l instanceof Promise
            }
            return n(e) ? s(e) ? yield e(d) : e(d) : e
        })
    }
    let S = !1;

    function y(e) {
        if (chrome.storage[e] === void 0) throw new Error(`Check your storage permission in manifest.json: ${e} is not defined`)
    }

    function x(e, d, n) {
        var s, l, r, c, u, f;
        let o = null,
            t = [];
        const a = (s = n == null ? void 0 : n.storageType) !== null && s !== void 0 ? s : h.Local,
            A = (l = n == null ? void 0 : n.liveUpdate) !== null && l !== void 0 ? l : !1,
            z = (c = (r = n == null ? void 0 : n.serialization) === null || r === void 0 ? void 0 : r.serialize) !== null && c !== void 0 ? c : i => i,
            C = (f = (u = n == null ? void 0 : n.serialization) === null || u === void 0 ? void 0 : u.deserialize) !== null && f !== void 0 ? f : i => i;
        S === !1 && a === h.Session && (n == null ? void 0 : n.sessionAccessForContentScripts) === !0 && (y(a), chrome.storage[a].setAccessLevel({
            accessLevel: m.ExtensionPagesAndContentScripts
        }).catch(i => {
            console.warn(i), console.warn("Please call setAccessLevel into different context, like a background script.")
        }), S = !0);
        const E = () => g(this, void 0, void 0, function* () {
            var i;
            y(a);
            const v = yield chrome.storage[a].get([e]);
            return (i = C(v[e])) !== null && i !== void 0 ? i : d
        }),
            p = () => {
                t.forEach(i => i())
            },
            D = i => g(this, void 0, void 0, function* () {
                o = yield w(i, o), yield chrome.storage[a].set({
                    [e]: z(o)
                }), p()
            }),
            F = i => (t = [...t, i], () => {
                t = t.filter(v => v !== i)
            }),
            N = () => o;
        E().then(i => {
            o = i, p()
        });

        function U(i) {
            return g(this, void 0, void 0, function* () {
                if (i[e] === void 0) return;
                const v = C(i[e].newValue);
                o !== v && (o = yield w(v, o), p())
            })
        }
        return A && chrome.storage[a].onChanged.addListener(U), {
            get: E,
            set: D,
            getSnapshot: N,
            subscribe: F
        }
    }
    var L = function (e, d, n, s) {
        function l(r) {
            return r instanceof n ? r : new n(function (c) {
                c(r)
            })
        }
        return new (n || (n = Promise))(function (r, c) {
            function u(t) {
                try {
                    o(s.next(t))
                } catch (a) {
                    c(a)
                }
            }

            function f(t) {
                try {
                    o(s.throw(t))
                } catch (a) {
                    c(a)
                }
            }

            function o(t) {
                t.done ? r(t.value) : l(t.value).then(u, f)
            }
            o((s = s.apply(e, d || [])).next())
        })
    };
    const T = x("theme-storage-key", "light", {
        storageType: h.Local,
        liveUpdate: !0
    }),
        _ = Object.assign(Object.assign({}, T), {
            toggle: () => L(void 0, void 0, void 0, function* () {
                yield T.set(e => e === "light" ? "dark" : "light")
            })
        });
    async function b() {
        console.log("initial theme:", await _.get()), await _.toggle(), console.log("toggled theme:", await _.get())
    }
    console.log("content script loaded"), b()
})();