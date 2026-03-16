# Enjambre Digital de IA — Agente de Navegación

> **Gemini Live Agent Challenge**  
> **Redefiniendo la Interacción: De Chatbots Estáticos a Experiencias Inmersivas**  
> **Categoría: UI Navigator ☸️**

**Autor:** Juan Camilo Atencia Amin  
**Perfil GDG:** [https://gdg.community.dev/u/juan_camilo2](https://gdg.community.dev/u/juan_camilo2)

🌐 [Read in English](README.md)

---

Una **Progressive Web App (PWA)** que despliega un enjambre de 6 agentes de IA potenciado por **Gemini 3.1 Flash-Lite**. Escribe un objetivo de investigación y el enjambre navega la web de forma autónoma mediante un navegador Playwright del lado del servidor, analiza los hallazgos y entrega un informe profesional — todo transmitido en tiempo real vía WebSocket.

La aplicación es instalable en escritorio y móvil, funciona offline para la interfaz, y ofrece una experiencia inmersiva a pantalla completa cuando se lanza desde la pantalla de inicio.

---

## Demo

### Captura de Pantalla — Pipeline de Flujo + Navegación SoM

![Pipeline de flujo y vista del navegador con etiquetas SoM](evidence/Screenshot%202026-03-15%20182709.png)

> Izquierda: el navegador del servidor mostrando círculos rojos numerados SoM sobre elementos interactivos. Derecha: el pipeline hexagonal animado con los 6 agentes y métricas en tiempo real.

### Despliegue en Cloud Run — Servicio en Vivo + Historial de Builds + Cloud Logging

[![Prueba de Despliegue en Cloud Run](https://img.youtube.com/vi/fvQrBcp5cAc/maxresdefault.jpg)](https://youtu.be/fvQrBcp5cAc)

> Grabación de pantalla demostrando que el backend se ejecuta en Google Cloud: detalles del servicio en Cloud Run, Cloud Logging en vivo e historial de Cloud Build.

Referencias de código:
- [`cloudbuild.yaml`](cloudbuild.yaml) — Definición del pipeline CI/CD
- [`backend/cloud_logging.py`](backend/cloud_logging.py) — Integración con Cloud Logging API
- [`deploy.ps1`](deploy.ps1) / [`deploy.sh`](deploy.sh) — Scripts de despliegue automatizado
- [`backend/Dockerfile`](backend/Dockerfile) — Imagen de contenedor para Cloud Run

---

## Arquitectura

![Arquitectura de Contenedores](evidence/architecture-Container%20Architecture.drawio.png)

```
┌──────────────────────────────────────────────────────────────────────┐
│  Navegador (React 19 PWA)                                            │
│  ┌─────────────┐  ┌───────────┐  ┌──────────────┐  ┌─────────────┐ │
│  │ 💬 Chat      │  │ 🐝 Enjambre│ │ ⚡ Flujo      │  │ 📝 Informe  │ │
│  │ Objetivo     │  │ Actividad │  │ Pipeline hex │  │ Markdown +  │ │
│  │ Plan pasos   │  │ Logs vivo │  │ Canvas anim. │  │ Export PDF  │ │
│  └──────┬───────┘  └─────┬─────┘  └──────┬───────┘  └──────┬──────┘ │
│         └────────────────┴───────────────┴──────────────────┘        │
│                              │ WebSocket                             │
└──────────────────────────────┼───────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Backend (Cloud Run — Python FastAPI)                                │
│                                                                      │
│  ┌──────────────┐    ┌────────────────────────────────────────────┐  │
│  │ Playwright    │    │           Gemini 3.1 Flash-Lite            │  │
│  │ (Chromium     │    │                                            │  │
│  │  headless)    │◄──►│  🧠 Orquestador ──► 🔍 Web Scout          │  │
│  │              │    │         │                   │               │  │
│  │ • Screenshot │    │         ▼                   ▼               │  │
│  │ • SoM tags   │    │  📊 Analista ──► 💡 Estrategia ──► 📝 Inf. │  │
│  │ • Navegación │    │                                  │          │  │
│  └──────────────┘    │                           🔍 Auditor       │  │
│                      └────────────────────────────────────────────┘  │
│  ┌───────────────┐                                                   │
│  │ Cloud Logging  │                                                   │
│  └───────────────┘                                                   │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Cómo el Agente "Ve" la Pantalla — Híbrido DOM + Visión (SoM)

El sistema de percepción del agente es un **enfoque híbrido** que combina **análisis del DOM** con **comprensión visual pura**. El sistema **no requiere acceso al DOM** pero **mejora su precisión cuando el DOM está disponible** — cumpliendo con el requisito del challenge de funcionar "con o sin depender de APIs o acceso al DOM."

### El Pipeline Set-of-Marks (SoM)

```
┌──────────────────────────────────────────────────────────────────┐
│  PASO 1 — Descubrimiento de Elementos (mejorado por DOM,        │
│           no dependiente del DOM)                                │
│                                                                  │
│  generate_tag_map() inyecta JS en la página para encontrar       │
│  elementos interactivos mediante selectores:                     │
│    a[href], button, input, textarea, select, [role="button"],    │
│    [role="link"], [role="tab"], [onclick], [tabindex], ...       │
│                                                                  │
│  Para cada elemento extrae:                                      │
│    • Selector CSS (para clics programáticos precisos)            │
│    • Coordenadas del bounding box (cx, cy, w, h)                │
│    • Etiqueta de texto (textContent, aria-label, placeholder)    │
│    • Tipo de tag HTML (button, input, a, etc.)                   │
│                                                                  │
│  ⚠️ Si el DOM es inaccesible: las coordenadas solas bastan.     │
│     El sistema recurre a mouse.click(cx, cy).                    │
└──────────────────┬───────────────────────────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────────────────────────┐
│  PASO 2 — Anotación Visual (SoM Overlay — del lado servidor)    │
│                                                                  │
│  som.py toma la captura de pantalla (bytes JPEG) y el tag_map,   │
│  dibuja CÍRCULOS ROJOS NUMERADOS sobre cada elemento interactivo │
│  usando Pillow. Esto ocurre del lado del servidor — no se        │
│  necesita inyección en el navegador.                             │
│                                                                  │
│  Resultado: una imagen anotada donde cada elemento clicable      │
│  tiene un círculo rojo numerado encima.                          │
└──────────────────┬───────────────────────────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────────────────────────┐
│  PASO 3 — Comprensión Multimodal (Gemini Vision)                 │
│                                                                  │
│  La IA recibe DOS entradas simultáneamente:                      │
│    1. La captura anotada (visual — Gemini ve la página)          │
│    2. El TAG_MAP como texto estructurado (semántico — etiquetas) │
│                                                                  │
│  Gemini cruza los números rojos visuales con las etiquetas       │
│  del TAG_MAP para tomar decisiones precisas. Este enfoque de     │
│  doble canal significa que el agente tanto VE el diseño de la    │
│  página como LEE los metadatos de los elementos.                 │
└──────────────────┬───────────────────────────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────────────────────────┐
│  PASO 4 — Ejecución de Acciones (DOM primero, coordenadas       │
│           como respaldo)                                         │
│                                                                  │
│  Cuando Gemini llama click_tag(id) o type_tag(id, texto):        │
│                                                                  │
│  1. Intenta selector CSS (del DOM) → el.click() / el.fill(text) │
│     ✅ Más preciso — funciona incluso si el elemento se movió    │
│                                                                  │
│  2. Si el selector falla → recurre a clic por coordenadas:      │
│     page.mouse.click(cx, cy)                                     │
│     ✅ Funciona sin acceso al DOM — posicionamiento visual puro  │
│                                                                  │
│  Esta estrategia dual significa que el agente funciona en        │
│  CUALQUIER sitio web, incluyendo Shadow DOM, iframes o canvas.   │
└──────────────────────────────────────────────────────────────────┘
```

### Por Qué Esto Importa

| Enfoque | ¿Requiere DOM? | Precisión | ¿Funciona en Canvas/Shadow DOM? |
|---|:---:|:---:|:---:|
| **Agentes solo-DOM** | Sí | Alta | No |
| **Agentes solo-visión** | No | Media | Sí |
| **Nuestro Híbrido (SoM)** | **Opcional** | **La más alta** | **Sí** |

El enfoque híbrido nos da **lo mejor de ambos mundos**: metadatos del DOM para identificación precisa de elementos cuando están disponibles, y clics basados en coordenadas como respaldo universal. El agente puede operar en cualquier sitio web sin importar cómo esté construido.

---

## PWA — Progressive Web App

El frontend es una Progressive Web App completa:

- **Instalable**: Agregar a pantalla de inicio en móvil o escritorio para una experiencia tipo app
- **Shell offline**: El service worker cachea la interfaz (HTML, CSS, JS) para que la app cargue instantáneamente incluso sin conexión (los datos WebSocket requieren conectividad)
- **Modo standalone**: Se lanza sin la barra del navegador cuando está instalada
- **Responsive**: Diseñada para escritorio (navegador dividido + sidebar) con orientación horizontal

Archivos PWA:
- `frontend/public/manifest.json` — Web App Manifest con nombre, iconos, color del tema
- `frontend/public/sw.js` — Service Worker con estrategia de caché offline-first
- Registro del service worker en `frontend/src/main.tsx`

---

## Características Principales

| Característica | Descripción |
|---|---|
| **Enjambre de 6 Agentes** | Orquestador → Web Scout → Analista de Datos → Consultor Estratégico → Constructor de Informes → Auditor de Calidad — todos potenciados por el mismo modelo Gemini con instrucciones especializadas |
| **Híbrido DOM + Visión** | Usa selectores DOM cuando están disponibles para mayor precisión, recurre a clics por coordenadas para compatibilidad universal. No requiere acceso al DOM. |
| **Navegador del Lado Servidor** | Chromium headless vía Playwright ejecutándose en el backend. Las capturas se transmiten como JPEG base64 vía WebSocket — no se necesita extensión |
| **Set-of-Marks (SoM)** | Overlay server-side con Pillow dibuja círculos rojos numerados sobre elementos interactivos. Gemini lee los IDs de etiquetas para acciones pixel-perfect |
| **Flujo de Trabajo en Tiempo Real** | Visualización hexagonal animada del pipeline con partículas de flujo de datos, anillos de progreso e indicadores de estado |
| **i18n Multi-Idioma** | UI completa + sistema de ayuda en 4 idiomas: Inglés, Español, Portugués, Francés |
| **PWA** | Instalable, shell offline, modo de visualización standalone |
| **Exportación PDF** | Generación profesional de PDF multi-página (jsPDF + jspdf-autotable) con tablas, encabezados y paginación |
| **Confirmaciones de Seguridad** | Las acciones destructivas activan un diálogo de confirmación antes de ejecutarse |
| **Auditoría de Calidad** | Cada informe recibe una puntuación (0–100) y un veredicto del agente Auditor de Calidad |
| **Anti-Bot Stealth** | Inyección de JS stealth que oculta huellas de Playwright (navigator.webdriver, plugins, chrome runtime), user-agent realista, locale/timezone, headers HTTP y delays aleatorios tipo humano antes de cada acción |
| **Loop Breaker Inteligente** | Detección automática de ciclos: repetición de URL (3×), capturas de pantalla idénticas (3×), errores consecutivos (3×), sin progreso (8 rondas sin datos nuevos), detección de páginas bloqueadas (CAPTCHA, anti-bot, 403). Inyección de advertencia suave al modelo en la ronda 12. Terminación forzada con explicación clara + ejecución del pipeline de análisis con datos parciales |

---

## Los 6 Agentes

| Agente | Rol | Qué hace |
|---|---|---|
| 🧠 **Orquestador** | CEO | Descompone el objetivo del usuario en sub-tareas, coordina el enjambre, decide qué investigar |
| 🔍 **Web Scout** | Operador del navegador | Navega sitios, hace clic, escribe, hace scroll, extrae texto — usando capturas etiquetadas con SoM |
| 📊 **Analista de Datos** | Análisis | Procesa datos crudos, identifica patrones, crea comparaciones estructuradas |
| 💡 **Consultor Estratégico** | Insights | Genera recomendaciones estratégicas y marcos de decisión |
| 📝 **Constructor de Informes** | Escritor | Compila hallazgos en un informe Markdown profesional |
| 🔍 **Auditor de Calidad** | QA | Revisa el informe por precisión y completitud, asigna puntuación de calidad |

---

## Stack Tecnológico

| Capa | Tecnología |
|---|---|
| **Modelo IA** | Gemini 3.1 Flash-Lite (visión multimodal + llamada de funciones) |
| **Backend** | Python 3.11 · FastAPI · WebSocket · Playwright · Pillow |
| **Frontend** | React 19 · TypeScript · Vite · TailwindCSS · jsPDF (PWA) |
| **Internacionalización** | Sistema i18n personalizado (EN, ES, PT, FR) |
| **Nube** | Google Cloud Run · Cloud Build · Cloud Logging |
| **Nube / Deploy** | Google Cloud Run · Cloud Build · Cloud Logging |
| **IaC / Automatización** | `deploy.sh` (un comando) + `cloudbuild.yaml` (pipeline CI/CD) |

---

## Herramientas del Agente (11)

| Herramienta | Descripción |
|---|---|
| `click_tag` | Clic en elemento por ID de etiqueta SoM (selector CSS → fallback por coordenadas) |
| `type_tag` | Enfocar y escribir en elemento por ID de etiqueta |
| `press_key` | Presionar tecla del teclado (Enter, Tab, Escape, etc.) |
| `scroll_page` | Desplazar arriba/abajo |
| `go_back` | Retroceder en el historial del navegador |
| `navigate_to` | Ir a una URL específica |
| `wait_for_page` | Esperar a que la página termine de cargar |
| `extract_text` | Extraer texto visible (página completa o selector CSS) |
| `report_plan` | Declarar plan de ejecución paso a paso |
| `task_complete` | Señalar completación de tarea con resumen |
| `request_user_confirmation` | Compuerta de seguridad para acciones destructivas |

---

## Despliegue Automatizado en la Nube

**Región:** `us-central1` (por defecto, configurable)

> El despliegue está totalmente automatizado mediante scripts de infraestructura como código incluidos en este repositorio.

### Opción A — Script de despliegue con un comando

Los scripts `deploy.sh` / `deploy.ps1` automatizan **todo el pipeline** en un solo comando:
1. Construye el frontend React → `backend/static/`
2. Envía la imagen Docker a Cloud Build (`gcr.io/<TU_PROYECTO>/aerobrowser-backend`)
3. Despliega en Cloud Run con recursos compatibles con Playwright (2 CPU, 2 GiB RAM)

```bash
# macOS/Linux:
export GCP_PROJECT_ID="tu-id-de-proyecto"      # ← obligatorio
export GEMINI_API_KEY="tu-clave-gemini"         # ← obligatorio
chmod +x deploy.sh
./deploy.sh

# Windows PowerShell:
$env:GCP_PROJECT_ID="tu-id-de-proyecto"         # ← obligatorio
$env:GEMINI_API_KEY="tu-clave-gemini"            # ← obligatorio
.\deploy.ps1
```

| Variable | Obligatorio | Por defecto | Descripción |
|---|:---:|---|---|
| `GCP_PROJECT_ID` | **Sí** | — | ID de tu proyecto en Google Cloud |
| `GEMINI_API_KEY` | **Sí** | — | Tu clave API de Gemini |
| `GCP_REGION` | No | `us-central1` | Región de Cloud Run |
| `SERVICE_NAME` | No | `aerobrowser-backend` | Nombre del servicio en Cloud Run |

### Opción B — Pipeline CI/CD (`cloudbuild.yaml`)

El archivo `cloudbuild.yaml` en la raíz define un **pipeline automatizado de 4 pasos** para Cloud Build:

| Paso | Acción |
|:---:|---|
| 1 | Instalar dependencias del frontend y construir assets estáticos (Node.js 20) |
| 2 | Construir imagen Docker (Python 3.11 + Playwright + Chromium) |
| 3 | Push de imagen al Container Registry (`gcr.io/$PROJECT_ID/aerobrowser-backend`) |
| 4 | Desplegar en Cloud Run (2 CPU, 2 GiB, timeout 900s) |

Configurar un trigger de Cloud Build para ejecutar en cada push a `main`:

```bash
gcloud builds triggers create github \
  --repo-name="Agent-Challenge-AntiGravity" \
  --repo-owner="TU_USUARIO_GITHUB" \
  --branch-pattern="^main$" \
  --build-config="cloudbuild.yaml" \
  --substitutions="_GEMINI_API_KEY=tu-clave"
```

### Despliegue manual (referencia paso a paso)

Si prefieres ejecutar los comandos individualmente:

```bash
# 1. Construir frontend (si hubo cambios)
cd frontend && npm run build && cd ../backend

# 2. Build & push de imagen Docker vía Cloud Build
gcloud builds submit --tag gcr.io/$GCP_PROJECT_ID/aerobrowser-backend --project $GCP_PROJECT_ID

# 3. Desplegar en Cloud Run
# macOS/Linux:
gcloud run deploy aerobrowser-backend \
  --image gcr.io/$GCP_PROJECT_ID/aerobrowser-backend \
  --project $GCP_PROJECT_ID \
  --set-env-vars GEMINI_API_KEY=$GEMINI_API_KEY \
  --platform managed --region us-central1 \
  --allow-unauthenticated --memory 2Gi --cpu 2 --timeout 900

# Windows PowerShell (una sola línea):
gcloud run deploy aerobrowser-backend --image gcr.io/$env:GCP_PROJECT_ID/aerobrowser-backend --project $env:GCP_PROJECT_ID --set-env-vars GEMINI_API_KEY=$env:GEMINI_API_KEY --platform managed --region us-central1 --allow-unauthenticated --memory 2Gi --cpu 2 --timeout 900
```

### Archivos de despliegue

| Archivo | Propósito |
|---|---|
| `deploy.sh` | **Despliegue automatizado con un comando** — Linux/macOS (build → push → deploy) |
| `deploy.ps1` | **Despliegue automatizado con un comando** — Windows PowerShell |
| `cloudbuild.yaml` | **Pipeline CI/CD de Cloud Build** (definición IaC de 4 pasos) |
| `backend/Dockerfile` | Imagen del contenedor (Python 3.11 + Playwright + Chromium + fuentes) |

---

## Inicio Rápido — Desarrollo Local

### 1. Frontend

```bash
cd frontend
npm install
npm run build    # genera en backend/static/
```

### 2. Backend

```bash
cd backend
pip install -r requirements.txt
playwright install chromium
playwright install-deps chromium

# Configura tu clave API de Gemini
# Windows PowerShell:
$env:GEMINI_API_KEY="tu_clave_aqui"
# macOS/Linux:
export GEMINI_API_KEY="tu_clave_aqui"

python -m uvicorn main:app --reload
# → http://localhost:8000
```

Abre `http://localhost:8000` en tu navegador — la PWA completa carga desde los archivos estáticos del backend.

---

## Estructura del Proyecto

```
├── cloudbuild.yaml           # ← Pipeline CI/CD de Cloud Build (IaC)
├── deploy.sh                 # ← Script de despliegue con un comando
├── backend/
│   ├── main.py               # Servidor FastAPI + WebSocket + orquestación del enjambre
│   ├── agent.py              # Configuración del agente Gemini (herramientas + prompt)
│   ├── swarm.py              # SwarmSession — pipeline multi-agente
│   ├── browser.py            # BrowserSession de Playwright (capturas, SoM, acciones)
│   ├── som.py                # Overlay Set-of-Marks — dibujo server-side con Pillow
│   ├── adk_agent.py          # Definición del agente ADK
│   ├── cloud_logging.py      # Integración con Google Cloud Logging
│   ├── requirements.txt
│   ├── Dockerfile
│   └── static/               # ← salida del build del frontend
├── frontend/
│   ├── index.html            # Punto de entrada HTML con meta tags PWA
│   ├── public/
│   │   ├── manifest.json     # ← Web App Manifest de la PWA
│   │   └── sw.js             # ← Service Worker (caché offline)
│   └── src/
│       ├── App.tsx            # App React principal (WebSocket, tabs, estado)
│       ├── WorkflowView.tsx   # Canvas animado del pipeline hexagonal
│       ├── HelpModal.tsx      # Overlay de ayuda multi-idioma
│       ├── i18n.ts            # Traducciones (4 idiomas) + contenido de ayuda
│       ├── pdfgen.ts          # Generación profesional de PDF
│       └── main.tsx           # Punto de entrada React + registro del SW
└── README.md
```

---

## Servicios de Google Cloud Utilizados

1. **Cloud Run** — Backend containerizado con FastAPI + Playwright (auto-scaling, managed)
2. **Cloud Build** — Pipeline CI/CD automatizado para construir y desplegar imágenes de contenedor
3. **Cloud Logging** — Logging estructurado con severidad, seguimiento de sesión y tipos de evento
4. **Container Registry** — Almacenamiento de imágenes Docker
5. **Gemini API** — Modelo IA multimodal para visión + llamada de funciones en los 6 agentes

---

## Cómo Piensa el Enjambre

1. **El usuario dice**: "Compara los planes de precios de Notion, Clickup y Monday.com"
2. **El Orquestador planifica**: Navegar a cada sitio → extraer datos de precios → comparar
3. **El Web Scout navega**: Capturas etiquetadas → `navigate_to("notion.so/pricing")` → `extract_text` → repetir para cada sitio
4. **El Analista de Datos** procesa los datos crudos en tablas comparativas estructuradas
5. **El Consultor Estratégico** agrega insights de mercado y recomendaciones
6. **El Constructor de Informes** compila un informe Markdown profesional
7. **El Auditor de Calidad** califica el informe y emite un veredicto

Todos los pasos se transmiten en tiempo real vía WebSocket — visibles en las pestañas Chat, Enjambre y Flujo simultáneamente.

---

## Autor

Construido para el Gemini Agent Challenge por **Juan Camilo Atencia Amin**.  
Perfil GDG: [https://gdg.community.dev/u/juan_camilo2](https://gdg.community.dev/u/juan_camilo2)
