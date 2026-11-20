/*
 * STUDY SPOT MAP (prototype)
 * Leaflet map of UT campus. Draws the campus from CAMPUS_MAP_DATA (OpenStreetMap export),
 * with the standard OpenStreetMap street map underneath where the browser allows it.
 * Pins follow the Study Spot Directory filters.
 */
(function () {
    "use strict";
    const $ = s => document.querySelector(s);
    const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const track = (n, p) => { try { if (typeof window.gtag === "function") window.gtag("event", n, p || {}); } catch (e) { /* ignore */ } };

    function init() {
        const el = $("#spotMap");
        const wrap = $("#spotMapWrap");
        if (!el || !wrap) return;
        if (typeof L === "undefined" || typeof CAMPUS_MAP_DATA === "undefined") {
            wrap.hidden = true;
            return;
        }
        const spots = (typeof STUDY_SPOTS !== "undefined" ? STUDY_SPOTS : []);
        const GEO = typeof SPOT_GEO !== "undefined" ? SPOT_GEO : {};

        const bounds = L.latLngBounds(CAMPUS_MAP_DATA.bounds);
        const map = L.map(el, {
            zoomControl: false,
            scrollWheelZoom: false,       // don't trap page scrolling
            minZoom: 13, maxZoom: 19,
            zoomSnap: 0.25, zoomDelta: 0.5, wheelPxPerZoomLevel: 120,
            maxBounds: bounds.pad(0.02),
            maxBoundsViscosity: 1.0,
            attributionControl: true,
            preferCanvas: true
        });
        map.fitBounds(bounds, { padding: [0, 0] });
        // Never zoom out past the drawn area, so there is no empty space around it.
        const fitMin = () => map.setMinZoom(Math.max(13, map.getBoundsZoom(bounds, false)));
        L.control.zoom({ position: "bottomright" }).addTo(map);
        map.attributionControl.setPrefix(false);
        // Let people scroll-zoom after they click into the map.
        map.on("focus click", () => map.scrollWheelZoom.enable());
        map.on("blur mouseout", () => map.scrollWheelZoom.disable());

        // The whole area is drawn from OpenStreetMap data, so the map looks the same everywhere.
        map.attributionControl.addAttribution('Map data &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors');

        // Campus drawing, in the site's colors.
        const css = () => {
            const st = getComputedStyle(document.documentElement);
            const v = n => st.getPropertyValue(n).trim();
            return { bg: v("--warm-ivory"), green: v("--sage-light"), greenLine: v("--sage-green"), water: v("--muted-blue-light"),
                waterLine: v("--muted-blue"), building: v("--white"), buildingLine: v("--charcoal"), path: v("--soft-terracotta"), road: v("--charcoal") };
        };
        const canvas = L.canvas({ padding: 0.3 });
        const layers = {};
        function drawCampus() {
            Object.values(layers).forEach(l => map.removeLayer(l));
            const c = css();
            const D = CAMPUS_MAP_DATA.layers;
            const add = (key, style, opts) => { layers[key] = L.geoJSON(D[key], Object.assign({ style, renderer: canvas, interactive: false }, opts || {})).addTo(map); };
            add("green", { color: c.greenLine, weight: 0.5, opacity: 0.35, fillColor: c.green, fillOpacity: 0.95 });
            add("water", { color: c.waterLine, weight: 0.8, fillColor: c.water, fillOpacity: 1 });
            add("roadMinor", { color: c.road, weight: 1.5, opacity: 0.14 });
            add("road", { color: c.road, weight: 4, opacity: 0.16 });
            add("path", { color: c.path, weight: 1, opacity: 0.3, dashArray: "1 3" });
            togglePaths();
            add("creek", { color: c.waterLine, weight: 2.5, opacity: 0.8 });
            layers.building = L.geoJSON(D.building, {
                renderer: canvas,
                style: f => ({ color: c.buildingLine, weight: 0.6, opacity: 0.35, fillColor: c.building, fillOpacity: f.properties.n ? 0.95 : 0.75 }),
                onEachFeature: (f, layer) => { if (f.properties.n) layer.bindTooltip(esc(f.properties.n), { sticky: true, direction: "top", className: "bldg-tip" }); }
            }).addTo(map);
            Object.values(markers).forEach(m => m.bringToFront && m.bringToFront());
        }

        // Pins
        const markers = {};
        const pinIcon = (spot, geo) => L.divIcon({
            className: "",
            html: `<span class="spot-pin spot-pin-${spot.type === "outdoor" ? "outdoor" : "indoor"}${geo.approx ? " spot-pin-approx" : ""}" aria-hidden="true"></span>`,
            iconSize: [26, 26], iconAnchor: [13, 13], popupAnchor: [0, -12]
        });
        const dirUrl = g => `https://www.google.com/maps/dir/?api=1&travelmode=walking&destination=${g.lat},${g.lng}`;
        function popupHtml(s, g) {
            const chips = [s.type === "outdoor" ? "Outdoor" : "Indoor", s.vibe === "social" ? "Social" : "Quiet",
                s.openLate ? "Open late" : "", s.outlets ? "Outlets" : "", s.coffeeNearby ? "Coffee nearby" : "", s.nap ? "Nap spot" : ""].filter(Boolean);
            return `<div class="spot-pop">
                <strong>${esc(s.name)}</strong>
                <div class="spot-pop-chips">${chips.map(c => `<span>${esc(c)}</span>`).join("")}</div>
                ${s.hours ? `<p>Hours: ${esc(s.hours)}</p>` : ""}
                ${s.tip ? `<p class="spot-pop-tip">${esc(s.tip)}</p>` : ""}
                ${g.approx ? `<p class="spot-pop-approx">Approximate location</p>` : ""}
                <div class="spot-pop-actions">
                    ${window.EQ_DIR ? window.EQ_DIR.dirButton({ lat: g.lat, lng: g.lng, walk: true, name: s.name }, "pop-dir") : `<a href="${dirUrl(g)}" target="_blank" rel="noopener noreferrer">Walking directions</a>`}
                    <button type="button" data-map-card="${esc(s.name)}">See details</button>
                </div>
            </div>`;
        }
        spots.forEach(s => {
            const g = GEO[s.name];
            if (!g) return;
            const m = L.marker([g.lat, g.lng], { icon: pinIcon(s, g), title: s.name, keyboard: true, riseOnHover: true });
            m.bindPopup(popupHtml(s, g), { maxWidth: 260, autoPanPaddingTopLeft: [16, 16], autoPanPaddingBottomRight: [56, 16] });
            m.on("popupopen", () => track("map_pin_open", { spot: s.name }));
            markers[s.name] = m;
        });

        // Walkways only show once you zoom in, so the overview stays calm.
        function togglePaths() {
            if (!layers.path) return;
            if (map.getZoom() >= 17) { if (!map.hasLayer(layers.path)) layers.path.addTo(map); }
            else if (map.hasLayer(layers.path)) map.removeLayer(layers.path);
        }
        map.on("zoomend", togglePaths);
        drawCampus();
        window.matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", drawCampus);

        // Off-campus spots get directions links instead of pins.
        const offWrap = $("#spotOffMap");
        function renderOff(names) {
            const off = spots.filter(s => !GEO[s.name] && names.has(s.name));
            offWrap.hidden = !off.length;
            offWrap.innerHTML = off.length ? `<span>Off campus:</span> ` + off.map(s =>
                `<a href="https://www.google.com/maps/dir/?api=1&travelmode=transit&destination=${encodeURIComponent(s.name + ", Austin, TX")}" target="_blank" rel="noopener noreferrer">${esc(s.name)} →</a>`).join("") : "";
        }

        // Follow the directory filters: show pins for the cards currently listed.
        const grid = $("#studySpotsGrid");
        function syncPins() {
            const names = new Set(Array.from(grid.querySelectorAll(".res-card .res-title")).map(t => t.textContent.trim()));
            let shown = 0;
            Object.entries(markers).forEach(([name, m]) => {
                if (names.has(name)) { if (!map.hasLayer(m)) m.addTo(map); shown++; }
                else if (map.hasLayer(m)) map.removeLayer(m);
            });
            $("#spotMapCount").textContent = names.size ? `${shown} spot${shown === 1 ? "" : "s"}` : "";
            renderOff(names);
            addMapButtons();
        }
        new MutationObserver(syncPins).observe(grid, { childList: true });

        // "Show on map" button on each directory card.
        function addMapButtons() {
            grid.querySelectorAll(".res-card:not([data-mapbtn])").forEach(card => {
                card.dataset.mapbtn = "1";
                const name = (card.querySelector(".res-title")?.textContent || "").trim();
                if (!markers[name]) return;
                const footer = card.querySelector(".res-footer");
                if (footer) footer.insertAdjacentHTML("beforeend", `<button type="button" class="map-jump" data-show-on-map="${esc(name)}">Show on map</button>`);
            });
        }
        function showOnMap(name) {
            const m = markers[name];
            if (!m) return;
            if (!map.hasLayer(m)) m.addTo(map);
            wrap.scrollIntoView({ behavior: "smooth", block: "center" });
            setTimeout(() => { map.setView(m.getLatLng(), Math.max(map.getZoom(), 18)); m.openPopup(); }, 350);
            track("map_show_spot", { spot: name });
        }

        document.addEventListener("click", e => {
            const show = e.target.closest("[data-show-on-map]");
            if (show) { showOnMap(show.dataset.showOnMap); return; }
            const card = e.target.closest("[data-map-card]");
            if (card) {
                const name = card.dataset.mapCard;
                const target = Array.from(grid.querySelectorAll(".res-card")).find(c => (c.querySelector(".res-title")?.textContent || "").trim() === name);
                if (target) {
                    map.closePopup();
                    target.scrollIntoView({ behavior: "smooth", block: "center" });
                    target.classList.add("card-flash");
                    setTimeout(() => target.classList.remove("card-flash"), 1600);
                }
                return;
            }
            const dir = e.target.closest("[data-map-dir]");
            if (dir) track("map_directions", { spot: dir.dataset.mapDir });
        });

        // You are here + closest spots.
        // Location is only requested when someone taps the button. It never leaves the device:
        // it's used to draw the dot and sort distances, and it isn't stored or sent anywhere.
        let me = null, meRing = null;
        const locBtn = $("#spotLocate"), locMsg = $("#spotMapMsg"), nearWrap = $("#spotNearby");
        const say = (t, tone) => { locMsg.innerHTML = t; locMsg.hidden = !t; locMsg.dataset.tone = tone || ""; };
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
        const fixDenied = isIOS
            ? "To turn it on: Settings → Privacy & Security → Location Services → Safari Websites → While Using. Then tap “aA” in the address bar → Website Settings → Location → Allow."
            : "To turn it on: tap the icon left of the web address → Permissions (or Site settings) → Location → Allow.";
        const WALK_M_PER_MIN = 80;   // about 3 mph

        function showNearest(ll) {
            const visible = Object.entries(markers).filter(([, m]) => map.hasLayer(m));
            const near = visible.map(([name, m]) => ({ name, d: ll.distanceTo(m.getLatLng()) }))
                .sort((a, b) => a.d - b.d).slice(0, 3);
            if (!near.length) { nearWrap.hidden = true; return; }
            nearWrap.hidden = false;
            nearWrap.innerHTML = `<span class="spot-nearby-label">Closest to you</span>` + near.map(n => {
                const mins = Math.max(1, Math.round(n.d / WALK_M_PER_MIN));
                return `<button type="button" class="spot-nearby-item" data-show-on-map="${esc(n.name)}"><strong>${esc(n.name)}</strong><span>${mins} min walk</span></button>`;
            }).join("");
        }

        locBtn.addEventListener("click", () => {
            if (!navigator.geolocation || !window.isSecureContext) {
                say("Your browser can't share location on this page.", "warn"); return;
            }
            say("Finding you…");
            locBtn.disabled = true;
            navigator.geolocation.getCurrentPosition(pos => {
                locBtn.disabled = false;
                const ll = L.latLng(pos.coords.latitude, pos.coords.longitude);
                const acc = Math.min(pos.coords.accuracy || 0, 400);
                if (me) { map.removeLayer(me); map.removeLayer(meRing); }
                meRing = L.circle(ll, { radius: acc, color: "#2b7de9", weight: 1, opacity: 0.4, fillColor: "#2b7de9", fillOpacity: 0.1, interactive: false }).addTo(map);
                me = L.circleMarker(ll, { radius: 8, color: "#fff", weight: 3, fillColor: "#2b7de9", fillOpacity: 1 }).addTo(map).bindTooltip("You are here");
                locBtn.textContent = "Update my location";
                track("map_locate", { result: "ok" });                  // no coordinates are sent
                if (bounds.pad(0.15).contains(ll)) {
                    map.setView(ll, Math.max(map.getZoom(), 16.5));
                    say("");
                    showNearest(ll);
                } else {
                    say("You're not near campus right now. The closest spots will show here when you are.");
                    nearWrap.hidden = true;
                }
            }, err => {
                locBtn.disabled = false;
                const blockedByPage = /permissions policy|not allowed in this document|disabled in this document/i.test(err.message || "");
                track("map_locate", { result: blockedByPage ? "blocked" : ["", "denied", "unavailable", "timeout"][err.code] || "error" });
                if (blockedByPage) say("Location is turned off in this preview. It works on the live site.", "warn");
                else if (err.code === 1) say("Location is off for this site. " + fixDenied, "warn");
                else if (err.code === 3) say("That took too long. Step outside or near a window and try again.", "warn");
                else say("Your phone couldn't find your location. Check that Location Services are on, then try again.", "warn");
            }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
        });

        syncPins();
        // Open showing every pin.
        fitMin();
        const pinBounds = L.latLngBounds(Object.values(markers).map(m => m.getLatLng()));
        // Phones open fitted to the pins (bigger dots); wider screens open on the whole drawn area.
        const narrow = () => window.innerWidth < 700;
        const openView = () => narrow()
            ? map.fitBounds(pinBounds, { padding: [12, 12] })   // every pin in view, as large as possible
            : map.fitBounds(bounds, { padding: [0, 0] });
        openView();
        window.addEventListener("resize", fitMin);
        // Leaflet needs a size check once the section is visible.
        new IntersectionObserver((entries, obs) => {
            if (entries[0].isIntersecting) {
                map.invalidateSize(); fitMin();
                openView();
                obs.disconnect();
            }
        }).observe(el);
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => setTimeout(init, 0), { once: true });
    else setTimeout(init, 0);
})();
