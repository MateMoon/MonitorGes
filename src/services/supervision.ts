import type { Status } from "../data"
import type { EstadoGestion, EventoGarantia } from "../types"
import { apiRequest, ApiError } from "./api"

export interface SupervisionPriorityCase {
  id: string
  paciente: { nombre: string }
  problemaSalud: string
  nombreGarantia: string
  establecimiento: string
  fechaLimite: string
  estadoGestion: EstadoGestion
  estadoVencimiento: Status
  diasRestantes: number
  cantidadProfesionalesCoincidentes: number
  profesionalesCoincidentes: { usuarioId: string; nombre: string }[]
  motivosPrioridad: ("VENCIDA" | "CRITICA" | "SIN_PROFESIONAL_ACTIVO")[]
  prioridad: 1 | 2 | 3
}

export interface SupervisionSummary {
  fechaReferencia: string
  zonaHoraria: "America/Santiago"
  generadoAt: string
  alcance: "GLOBAL"
  indicadores: {
    totalGarantias: number
    pendientesResolucion: number
    enGestion: number
    cumplidas: number
    vencidasNoCumplidas: number
    proximas15DiasNoCumplidas: number
  }
  cobertura: {
    sinProfesional: number
    unProfesional: number
    variosProfesionales: number
    sinProfesionalNoCumplidas: number
  }
  criteriosCobertura: {
    rol: "TODOS"
    soloActivos: true
    profesionalesActivos: number
    profesionalesConReglasEfectivas: number
  }
  distribuciones: {
    soloNoCumplidas: true
    permiteSuperposicionEntreProfesionales: true
    porProblemaSalud: { problemaSalud: string; cantidad: number }[]
    porEstablecimiento: { establecimiento: string; cantidad: number }[]
    porProfesional: { usuarioId: string; nombre: string; cantidad: number }[]
  }
  prioritarios: SupervisionPriorityCase[]
}

const count = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value)

/** Reject an incomplete response rather than rendering missing metrics as zero. */
function validSummary(value: unknown): value is SupervisionSummary {
  if (!object(value) || value.alcance !== "GLOBAL" || value.zonaHoraria !== "America/Santiago" || typeof value.fechaReferencia !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.fechaReferencia) || typeof value.generadoAt !== "string" || Number.isNaN(Date.parse(value.generadoAt))) return false
  for (const [key, fields] of [
    ["indicadores", ["totalGarantias", "pendientesResolucion", "enGestion", "cumplidas", "vencidasNoCumplidas", "proximas15DiasNoCumplidas"]],
    ["cobertura", ["sinProfesional", "unProfesional", "variosProfesionales", "sinProfesionalNoCumplidas"]],
  ] as const) {
    const section = value[key]
    if (!object(section) || fields.some((field) => !count(section[field]))) return false
  }
  const criteria = value.criteriosCobertura
  if (!object(criteria) || criteria.rol !== "TODOS" || criteria.soloActivos !== true || !count(criteria.profesionalesActivos) || !count(criteria.profesionalesConReglasEfectivas)) return false
  const distributions = value.distribuciones
  if (!object(distributions) || distributions.soloNoCumplidas !== true || distributions.permiteSuperposicionEntreProfesionales !== true) return false
  for (const [key, labels] of [["porProblemaSalud", ["problemaSalud"]], ["porEstablecimiento", ["establecimiento"]], ["porProfesional", ["usuarioId", "nombre"]]] as const) {
    const rows = distributions[key]
    if (!Array.isArray(rows) || rows.some((row) => !object(row) || !count(row.cantidad) || labels.some((label) => typeof row[label] !== "string"))) return false
  }
  const statuses = ["normal", "atencion", "proxima", "critica", "vencida"]
  const management = ["SIN_GESTION", "EN_GESTION", "PENDIENTE_RESOLUCION", "CUMPLIDA"]
  return Array.isArray(value.prioritarios) && value.prioritarios.length <= 10 && value.prioritarios.every((row) => object(row)
    && ["id", "problemaSalud", "nombreGarantia", "establecimiento", "fechaLimite"].every((key) => typeof row[key] === "string")
    && object(row.paciente) && typeof row.paciente.nombre === "string"
    && typeof row.estadoVencimiento === "string" && statuses.includes(row.estadoVencimiento)
    && typeof row.estadoGestion === "string" && management.includes(row.estadoGestion)
    && typeof row.diasRestantes === "number" && Number.isSafeInteger(row.diasRestantes)
    && count(row.cantidadProfesionalesCoincidentes) && [1, 2, 3].includes(row.prioridad as number)
    && Array.isArray(row.profesionalesCoincidentes) && row.profesionalesCoincidentes.length === row.cantidadProfesionalesCoincidentes
    && row.profesionalesCoincidentes.every((professional) => object(professional) && typeof professional.usuarioId === "string" && typeof professional.nombre === "string")
    && Array.isArray(row.motivosPrioridad) && row.motivosPrioridad.every((reason) => ["VENCIDA", "CRITICA", "SIN_PROFESIONAL_ACTIVO"].includes(reason)))
}

export async function getSupervisionSummary(signal?: AbortSignal): Promise<SupervisionSummary> {
  const result = await apiRequest<{ data: unknown }>("/api/supervision/resumen", { signal, cache: "no-store" })
  if (!validSummary(result?.data)) throw new ApiError("El servidor devolvió un resumen incompleto. Intenta nuevamente.", [], "INVALID_SUPERVISION_RESPONSE")
  return result.data
}

interface ActivityGuarantee {
    id: string
    paciente: { nombre: string }
    problemaSalud: string
    nombreGarantia: string
    establecimiento: string
    estadoGestion: EstadoGestion
}
export interface SupervisionManagementEvent extends EventoGarantia { garantia: ActivityGuarantee }
export interface SupervisionImportReviewEvent extends Omit<EventoGarantia, "tipo" | "secuencia" | "tipoActuacion" | "comentario" | "estadoAnterior" | "estadoNuevo" | "respaldo"> {
  tipo: "REVISION_IMPORTACION"; secuencia: null; tipoActuacion: null; comentario: null; estadoAnterior: null; estadoNuevo: null; respaldo: null
  garantia: ActivityGuarantee
  revisionImportacion: { id: string; decision: "MISMA" | "DISTINTA"; actualizarDatos?: true; descripcion: string; justificacion: string; garantiaResultadoId: string
    origen: { importacionId: string; archivo: string | null; hoja: string | null; numeroFila: number | null }
  }
}
export type SupervisionActivityEvent = SupervisionManagementEvent | SupervisionImportReviewEvent

export interface SupervisionActivity {
  generadoAt: string
  zonaHoraria: "America/Santiago"
  alcance: "GLOBAL"
  limite: 30
  eventos: SupervisionActivityEvent[]
}

function validActivity(value: unknown): value is SupervisionActivity {
  if (!object(value) || value.alcance !== "GLOBAL" || value.zonaHoraria !== "America/Santiago" || value.limite !== 30 || typeof value.generadoAt !== "string" || Number.isNaN(Date.parse(value.generadoAt))) return false
  const states = ["SIN_GESTION", "EN_GESTION", "PENDIENTE_RESOLUCION", "CUMPLIDA"]
  const kinds = ["ACTUACION", "CAMBIO_ESTADO", "CUMPLIMIENTO", "REAPERTURA", "ANTECEDENTE_LEGADO", "REVISION_IMPORTACION"]
  const actions = ["CONTACTO_PACIENTE", "CITACION", "ATENCION_REALIZADA", "DERIVACION", "SOLICITUD_RESPALDO", "OTRA_GESTION"]
  return Array.isArray(value.eventos) && value.eventos.length <= 30 && value.eventos.every((event) => {
    if (!object(event) || typeof event.id !== "string" || typeof event.tipo !== "string" || !kinds.includes(event.tipo) || typeof event.createdAt !== "string" || Number.isNaN(Date.parse(event.createdAt))) return false
    if (event.tipo === "REVISION_IMPORTACION") {
      const review = event.revisionImportacion
      if (typeof event.autorNombre !== "string" || typeof event.usuarioId !== "string") return false
      if (event.secuencia !== null || ["tipoActuacion", "comentario", "estadoAnterior", "estadoNuevo", "respaldo"].some(key => event[key] !== null)) return false
      if (!object(review) || typeof review.id !== "string" || event.id !== `revision-importacion:${review.id}` || !["MISMA", "DISTINTA"].includes(review.decision as string)
        || ["descripcion", "justificacion", "garantiaResultadoId"].some(key => typeof review[key] !== "string") || !object(review.origen)) return false
      if (review.actualizarDatos !== undefined && (review.actualizarDatos !== true || review.decision !== "MISMA")) return false
      const origin = review.origen
      if (typeof origin.importacionId !== "string" || ["archivo", "hoja"].some(key => origin[key] !== null && typeof origin[key] !== "string") || (origin.numeroFila !== null && (!count(origin.numeroFila) || origin.numeroFila === 0))) return false
      if (!object(event.garantia) || event.garantia.id !== review.garantiaResultadoId) return false
    } else if (!count(event.secuencia)) return false
    if (event.tipoActuacion !== null && (typeof event.tipoActuacion !== "string" || !actions.includes(event.tipoActuacion))) return false
    if (["autorNombre", "usuarioId", "comentario", "respaldo"].some((key) => event[key] !== null && typeof event[key] !== "string")) return false
    if (["estadoAnterior", "estadoNuevo"].some((key) => { const state = event[key]; return state !== null && (typeof state !== "string" || !states.includes(state)) })) return false
    const guarantee = event.garantia
    return object(guarantee) && ["id", "problemaSalud", "nombreGarantia", "establecimiento"].every((key) => typeof guarantee[key] === "string")
      && typeof guarantee.estadoGestion === "string" && states.includes(guarantee.estadoGestion)
      && object(guarantee.paciente) && typeof guarantee.paciente.nombre === "string"
  })
}

export async function getSupervisionActivity(signal?: AbortSignal): Promise<SupervisionActivity> {
  const result = await apiRequest<{ data: unknown }>("/api/supervision/eventos", { signal, cache: "no-store" })
  if (!validActivity(result?.data)) throw new ApiError("El servidor devolvió un historial incompleto. Intenta nuevamente.", [], "INVALID_SUPERVISION_ACTIVITY_RESPONSE")
  return result.data
}
