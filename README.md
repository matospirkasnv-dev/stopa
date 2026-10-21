# Stopa – denník outdoorových aktivít

Statická webová aplikácia (bez buildu). Nasadenie na Netlify: pretiahnite tento priečinok na záložku **Deploys**.

## Štruktúra

| Súbor | Úloha |
|---|---|
| `index.html`, `css/style.css` | kostra a vzhľad (tmavý, responzívny) |
| `js/app.js` | smerovač (`#/`, `#/a/<id>`, `#/add`, `#/map`, `#/stats`, `#/settings`) |
| `js/geo.js` | parsery GPX / TCX / FIT, vzdialenosť, rýchlosť, štatistiky, doplnenie výšky |
| `js/photos.js` | čítanie EXIF (GPS + čas), zmenšenie, priradenie fotky k trase |
| `js/mapview.js` | MapLibre GL JS: 3D terén, trasa, značky, prehrávač |
| `js/charts.js` | interaktívne grafy výšky a rýchlosti |
| `js/db.js` | úložisko (IndexedDB) a nastavenia |
| `js/pages-*.js` | jednotlivé stránky |

## Ako sa priraďujú fotografie

1. GPS aj čas v EXIF: z miest trasy do 300 m od GPS fotky sa vyberie to s najbližším časom.
2. Iba GPS: najbližší bod trasy do 300 m, inak sa použije GPS fotky (označená „mimo trasy“).
3. Iba čas: poloha sa interpoluje podľa času GPS záznamu (tolerancia 5 min mimo záznamu). Posun hodín fotoaparátu sa dá zadať.
4. Nič použiteľné: fotka ostane **nepriradená**, nikdy sa nedá na náhodné miesto. Dá sa umiestniť ručne.

## Dáta

Aktivita má `activityDate` (kedy sa uskutočnila) a `addedAt` (kedy bola pridaná) ako dve samostatné hodnoty. Radenie používa iba `activityDate`. Údaje sú v IndexedDB prehliadača, takže medzi zariadeniami sa nesynchronizujú. Zálohu robí Nastavenia → Exportovať.

## Návrh: používateľské účty a synchronizácia

Celá aplikácia pristupuje k dátam iba cez objekt `repo` v `js/db.js`, preto stačí vymeniť jeho implementáciu:

- **Supabase** (odporúčané): Postgres + Auth + Storage. Tabuľky `activities`, `tracks` (JSON/binárne pole), `photos` (metadáta) a bucket na fotografie. Prístup cez Row Level Security (`user_id = auth.uid()`).
- **Alternatíva v rámci Netlify:** Netlify Identity na prihlásenie a Netlify Blobs/Database cez Functions.
- Synchronizácia: každá aktivita má `id`, `addedAt` a `updatedAt`; lokálna IndexedDB zostane ako offline cache a pri pripojení sa zlúči podľa `updatedAt`.

## Limity a licencie

- **Mapové podklady:** `tile.openstreetmap.org` je určený na ľahké použitie; pri väčšej návštevnosti treba vlastný/platený poskytovateľ (MapTiler, Stadia, Mapbox). Esri satelit a CARTO tmavá mapa majú vlastné podmienky a vyžadujú uvedenie zdroja (v mape je).
- **Terén:** AWS Terrain Tiles (Terrarium) – verejné, bez kľúča, rozlíšenie sa mení podľa zoomu.
- **Výška chýbajúca v súbore:** Open-Meteo Elevation API (~90 m model, bez kľúča, bezplatné pre nekomerčné použitie, limitované počtom volaní). Pri výpadku sa výškové štatistiky zobrazia ako „nedostupné“.
- **Knižnice:** MapLibre GL JS sa načítava z unpkg CDN. Aplikácia na zobrazenie mapy potrebuje internet.
- **Úložisko prehliadača:** IndexedDB má kvótu podľa zariadenia; fotografie sa pri uložení zmenšujú na max. 1800 px.

## Čo sa vedome nerobí

Aplikácia je napísaná v čistom JavaScripte (ES moduly) bez frameworku, aby sa dala nasadiť bez buildu. React/TypeScript z pôvodného zadania nie je použitý.
