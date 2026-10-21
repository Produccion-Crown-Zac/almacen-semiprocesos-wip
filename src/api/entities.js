// src/api/entities.js
// Simulador Base44 con control de Auditoría de Inventario Físico vs SAP

const crearEntidadMock = (nombreTabla, datosIniciales = []) => {
  const storageKey = `base44_wip_${nombreTabla}`;

  const obtenerDatos = () => {
    const guardado = localStorage.getItem(storageKey);
    if (!guardado) {
      localStorage.setItem(storageKey, JSON.stringify(datosIniciales));
      return datosIniciales;
    }
    return JSON.parse(guardado);
  };

  const guardarDatos = (datos) => {
    localStorage.setItem(storageKey, JSON.stringify(datos));
  };

  return {
    list: async () => obtenerDatos(),
    filter: async (criterios) => {
      const datos = obtenerDatos();
      return datos.filter((item) =>
        Object.entries(criterios).every(([k, v]) => String(item[k]) === String(v))
      );
    },
    create: async (nuevoRegistro) => {
      const datos = obtenerDatos();
      const registroConId = {
        id: crypto.randomUUID(),
        created_date: new Date().toISOString(),
        verificado_fisico: "PENDIENTE",
        cantidad_fisica: null,
        ...nuevoRegistro,
      };
      datos.unshift(registroConId);
      guardarDatos(datos);
      return registroConId;
    },
    update: async (id, cambios) => {
      const datos = obtenerDatos();
      const index = datos.findIndex((item) => item.id === id);
      if (index !== -1) {
        datos[index] = { ...datos[index], ...cambios };
        guardarDatos(datos);
        return datos[index];
      }
      throw new Error("Registro no encontrado");
    },
    delete: async (id) => {
      const datos = obtenerDatos().filter((item) => item.id !== id);
      guardarDatos(datos);
      return true;
    },
    reiniciarAuditoria: async () => {
      const datos = obtenerDatos().map((item) => ({
        ...item,
        verificado_fisico: "PENDIENTE",
        cantidad_fisica: null,
      }));
      guardarDatos(datos);
      return datos;
    },
    syncFromExcel: async (filasNormalizadas) => {
      const datosActuales = obtenerDatos();
      let creados = 0;
      let actualizados = 0;

      filasNormalizadas.forEach((fila) => {
        const idxExistente = datosActuales.findIndex(
          (item) =>
            String(item.codigo_lote).toUpperCase() ===
            String(fila.codigo_lote).toUpperCase()
        );

        if (idxExistente !== -1) {
          datosActuales[idxExistente] = {
            ...datosActuales[idxExistente],
            calibre: fila.calibre,
            etapa: fila.etapa,
            cantidad_actual: fila.cantidad_actual,
            es_parcial: fila.cantidad_actual < 1500,
            ubicacion_rack:
              fila.ubicacion_rack || datosActuales[idxExistente].ubicacion_rack,
            diseno_sku:
              fila.diseno_sku || datosActuales[idxExistente].diseno_sku,
          };
          actualizados++;
        } else {
          datosActuales.unshift({
            id: crypto.randomUUID(),
            created_date: new Date().toISOString(),
            codigo_lote: fila.codigo_lote,
            lote_padre: fila.lote_padre || "",
            calibre: fila.calibre,
            etapa: fila.etapa,
            cantidad_inicial: fila.cantidad_inicial || fila.cantidad_actual,
            cantidad_actual: fila.cantidad_actual,
            merma_acumulada: 0,
            es_parcial: fila.cantidad_actual < 1500,
            ubicacion_rack: fila.ubicacion_rack,
            diseno_sku: fila.diseno_sku,
            estado_operativo: "DISPONIBLE",
            verificado_fisico: "PENDIENTE",
            cantidad_fisica: null,
          });
          creados++;
        }
      });

      guardarDatos(datosActuales);
      return { creados, actualizados, total: filasNormalizadas.length };
    },
  };
};

export const LoteLamina = crearEntidadMock("LoteLamina", [
  {
    id: "lot-1",
    codigo_lote: "LOT-101",
    lote_padre: "",
    calibre: "70",
    etapa: "VIRGEN",
    cantidad_inicial: 1500,
    cantidad_actual: 1500,
    merma_acumulada: 0,
    es_parcial: false,
    ubicacion_rack: "B1-C70-R01",
    diseno_sku: "SIN-IMPRESION",
    estado_operativo: "DISPONIBLE",
    verificado_fisico: "PENDIENTE",
    cantidad_fisica: null,
    created_date: "2026-10-18T14:00:00.000Z",
  },
  {
    id: "lot-2",
    codigo_lote: "LOT-098",
    lote_padre: "",
    calibre: "70",
    etapa: "VIRGEN",
    cantidad_inicial: 1500,
    cantidad_actual: 850,
    merma_acumulada: 0,
    es_parcial: true,
    ubicacion_rack: "B1-PICOS-01",
    diseno_sku: "SIN-IMPRESION",
    estado_operativo: "DISPONIBLE",
    verificado_fisico: "OK",
    cantidad_fisica: 850,
    created_date: "2026-10-17T09:30:00.000Z",
  },
  {
    id: "lot-3",
    codigo_lote: "LOT-098-A",
    lote_padre: "LOT-098",
    calibre: "70",
    etapa: "RECUBIERTA",
    cantidad_inicial: 650,
    cantidad_actual: 642,
    merma_acumulada: 8,
    es_parcial: true,
    ubicacion_rack: "B2-C70-R02",
    diseno_sku: "BARNIZ-ESTANDAR",
    estado_operativo: "DISPONIBLE",
    verificado_fisico: "PENDIENTE",
    cantidad_fisica: null,
    created_date: "2026-10-17T11:15:00.000Z",
  },
  {
    id: "lot-4",
    codigo_lote: "LOT-102",
    lote_padre: "",
    calibre: "75",
    etapa: "IMPRESA",
    cantidad_inicial: 1500,
    cantidad_actual: 1480,
    merma_acumulada: 20,
    es_parcial: false,
    ubicacion_rack: "B3-C75-R04",
    diseno_sku: "ARTE-TAPA-DORADA",
    estado_operativo: "DISPONIBLE",
    verificado_fisico: "PENDIENTE",
    cantidad_fisica: null,
    created_date: "2026-10-19T08:00:00.000Z",
  },
]);

export const MovimientoKardex = crearEntidadMock("MovimientoKardex", []);