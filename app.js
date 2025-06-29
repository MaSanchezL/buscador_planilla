require('dotenv').config();
const express = require('express');
const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');
const methodOverride = require('method-override');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json())
app.use(express.urlencoded({ extended: true }));
app.use(methodOverride('_method'));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));


// Validar archivo de credenciales
const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!fs.existsSync(credentialsPath)) {
  console.error(`❌ Archivo de credenciales no encontrado: ${credentialsPath}`);
  process.exit(1);
}
console.log('✅ Archivo de credenciales encontrado.');

console.log('KEY ENV VARIABLE:', process.env.GOOGLE_SERVICE_ACCOUNT_KEY)

const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);

const auth = new google.auth.GoogleAuth({
  credentials: credentials,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});


const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const SHEET_NAME = process.env.SHEET_NAME;

let sheets;


// Inicializar cliente Sheets
async function inicializarSheets() {
  const client = await auth.getClient();
  sheets = google.sheets({ version: 'v4', auth: client });
}
inicializarSheets().catch(console.error);

async function obtenerUsuariosDesdeSheets() {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A2:L`,
    });
    const rows = response.data.values || [];
    return rows.map(row => ({
      id: row[0] || '',
      nombre: row[1] || '',
      telefono: row[2] || '',
      mac: row[3] || '',
      app: row[4] || '',
      plataforma: row[5] || '',
      valor: row[6] || '',
      compartida: row[7] || '',
      url: row[8] || '',
      fecha_contratacion: row[9] || '',
      fecha_vencimiento_plan: row[10] || '',
      fecha_vencimiento_app: row[11] || '',
    }));
  } catch (err) {
    console.error('Error al obtener usuarios:', err.message);
    throw err;
  }
}

async function guardarUsuariosEnSheets(usuarios) {
  const values = usuarios.map(u => [
    u.id,
    u.nombre,
    u.telefono,
    u.mac,
    u.app,
    u.plataforma,
    u.valor,
    u.compartida,
    u.url,
    u.fecha_contratacion,
    u.fecha_vencimiento_plan,
    u.fecha_vencimiento_app,
  ]);
  try {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A2`,
      valueInputOption: 'RAW',
      resource: { values },
    });
  } catch (err) {
    console.error('Error al guardar usuarios:', err.message);
    throw err;
  }
}


// Obtener todos los datos
async function obtenerDatos() {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A1:Z1000`, // Ajusta rango según tus datos
    });

    const [headers, ...rows] = response.data.values || [[], []];
    const datos = rows.map(fila => {
      const obj = Object.fromEntries(headers.map((col, i) => [col, fila[i] || '']));
      obj.id = String(obj.id || '').trim();  // Normaliza el ID
      return obj;
    });
    return datos;
  } catch (err) {
    console.error('❌ Error al obtener datos:', err.message);
    throw err;
  }
}


// Buscar fila en Google Sheets por ID (asumiendo ID en columna A)
async function buscarFilaPorId(id) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A2:A1000`,
  });
  const filas = res.data.values || [];
  for (let i = 0; i < filas.length; i++) {
    if (filas[i][0] === String(id)) {
      return i + 2; // +2 porque fila 1 es encabezado y filas empiezan en 2
    }
  }
  return -1;
}

// Guardar nuevo registro (append)
async function guardarDatos(nuevaFila) {
  return await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A:L`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    resource: { values: [nuevaFila] },
  });
}

async function actualizarDatos(id, nuevaFila) {
  const datos = await obtenerDatos();  // lee todos
  const filaIndex = datos.findIndex(u => u.id === id);
  if (filaIndex === -1) throw new Error('ID no encontrado');

  datos[filaIndex] = {
    id: nuevaFila[0],
    nombre: nuevaFila[1],
    telefono: nuevaFila[2],
    mac: nuevaFila[3],
    app: nuevaFila[4],
    plataforma: nuevaFila[5],
    valor: nuevaFila[6],
    compartida: nuevaFila[7],
    url: nuevaFila[8],
    fecha_contratacion: nuevaFila[9],
    fecha_vencimiento_plan: nuevaFila[10],
    fecha_vencimiento_app: nuevaFila[11]
  };

  // Aquí guarda la data de nuevo en la hoja de cálculo
  await guardarDatos(datos);
}

// Borrar registro por id (limpiar fila)
async function borrarDatos(id) {
  const fila = await buscarFilaPorId(id);
  if (fila === -1) throw new Error(`ID ${id} no encontrado para borrar.`);
  const rango = `${SHEET_NAME}!A${fila}:L${fila}`;
  return await sheets.spreadsheets.values.clear({
    spreadsheetId: SPREADSHEET_ID,
    range: rango,
  });
}

// Rutas

app.get('/', (req, res) => {
  res.render('index');
});

app.get('/mostrar-todos', async (req, res) => {
  try {
    const datos = await obtenerDatos();
    const q = req.query.q?.toLowerCase() || '';
    const filtrados = q
      ? datos.filter(d =>
          Object.values(d).some(v => v.toLowerCase().includes(q))
        )
      : datos;
    res.render('tabla', { datos: filtrados });
  } catch (error) {
    res.status(500).send('Error al acceder a los datos.');
  }
});

app.get('/detalle/:id', async (req, res) => {
  try {
    const datos = await obtenerDatos();  // obtiene array de usuarios
    const idBuscado = req.params.id;
    const usuario = datos.find(u => u.id === idBuscado);

    if (!usuario) {
      return res.status(404).render('detalle', { usuario: null });
    }

    res.render('detalle', { usuario });
  } catch (error) {
    console.error('Error en /detalle/:id:', error);
    res.status(500).send('Error al obtener los datos');
  }
});

app.get('/crear', (req, res) => {
  res.render('crear');  // Renderiza la vista crear.ejs donde estará el formulario
});

app.post('/crear', async (req, res) => {
  try {
    const nuevoUsuario = req.body;

    // Validar campos
    for (const campo of ['nombre', 'telefono', 'mac', 'app', 'plataforma', 'valor', 'compartida', 'url', 'fecha_contratacion', 'fecha_vencimiento_plan', 'fecha_vencimiento_app']) {
      if (!nuevoUsuario[campo] || nuevoUsuario[campo].trim() === '') {
        return res.status(400).send(`El campo ${campo} es obligatorio.`);
      }
    }
    const client = await auth.getClient();
    sheets = google.sheets({ version: 'v4', auth: client });
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A2:A`,
    });
    const ids = (response.data.values || []).map(row => parseInt(row[0], 10));
    const nuevoId = ids.length > 0 ? Math.max(...ids) + 1 : 1;

    const filaNueva = [
      nuevoId.toString(),
      nuevoUsuario.nombre,
      nuevoUsuario.telefono,
      nuevoUsuario.mac,
      nuevoUsuario.app,
      nuevoUsuario.plataforma,
      nuevoUsuario.valor,
      nuevoUsuario.compartida,
      nuevoUsuario.url,
      nuevoUsuario.fecha_contratacion,
      nuevoUsuario.fecha_vencimiento_plan,
      nuevoUsuario.fecha_vencimiento_app,
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [filaNueva] },
    });

  // En lugar de res.redirect('/mostrar-todos');
res.status(200).send('Usuario creado exitosamente');

  } catch (error) {
    res.status(500).send('Error al guardar datos: ' + error.message);
  }
});


app.get('/editar/:id', async (req, res) => {
  try {
    const datos = await obtenerUsuariosDesdeSheets();
    const id = req.params.id.trim();
    const dato = datos.find(d => d.id === id);

    if (!dato) {
      return res.status(404).send('Dato no encontrado');
    }
    res.render('editar', { dato });
  } catch (error) {
    res.status(500).send('Error al obtener datos');
  }
});

// Función para validar usuario
function validarUsuario(usuario) {
  const errores = [];

  for (const [clave, valor] of Object.entries(usuario)) {
    if (typeof valor === 'string' && valor.trim() === '') {
      errores.push(`El campo '${clave}' no puede estar vacío`);
    }
  }

  if (!usuario.nombre || usuario.nombre.trim() === '') errores.push('El nombre es obligatorio');
  if (!usuario.telefono || usuario.telefono.trim() === '') errores.push('El teléfono es obligatorio');

  return errores;
}

async function borrarDatos(id) {
  const client = await auth.getClient();
  sheets = google.sheets({ version: 'v4', auth: client });

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A2:Z`, // Asumiendo que la fila 1 son encabezados
    auth: client,
  });

  const rows = response.data.values || [];

  const filaIndex = rows.findIndex(row => row[0] === id);
  if (filaIndex === -1) {
    throw new Error('ID no encontrado en la hoja');
  }

  const filaReal = filaIndex + 2;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    auth: client,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId: await obtenerSheetId(SPREADSHEET_ID, SHEET_NAME),
              dimension: 'ROWS',
              startIndex: filaReal - 1,
              endIndex: filaReal,
            },
          },
        },
      ],
    },
  });
}


async function obtenerSheetId(spreadsheetId, sheetName) {
  const client = await auth.getClient(); // Corrección aquí
  const sheetsApi = google.sheets({ version: 'v4', auth: client });

  const meta = await sheetsApi.spreadsheets.get({
    spreadsheetId,
  });

  const sheet = meta.data.sheets.find(s => s.properties.title === sheetName);
  if (!sheet) throw new Error(`La hoja ${sheetName} no existe`);

  return sheet.properties.sheetId;
}
async function crearUsuario(datos) {
  const authClient = await auth.getClient();
  sheets = google.sheets({ version: 'v4', auth: authClient });

  // Validar que todos los campos estén presentes
  const campos = ['nombre', 'telefono', 'mac', 'app', 'plataforma', 'valor', 'compartida', 'url', 'fecha_contratacion', 'fecha_vencimiento_plan', 'fecha_vencimiento_app'];
  const errores = campos.filter(campo => !datos[campo] || datos[campo].toString().trim() === '');

  if (errores.length > 0) {
    throw new Error(`Campos vacíos: ${errores.join(', ')}`);
  }

  // Obtener todos los usuarios para generar el siguiente ID automáticamente
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A2:A`,
  });

  const idsExistentes = response.data.values?.map(row => parseInt(row[0])) || [];
  const nuevoId = idsExistentes.length > 0 ? Math.max(...idsExistentes) + 1 : 1;

  // Agregar fila
  const fila = [
    nuevoId.toString(),
    datos.nombre,
    datos.telefono,
    datos.mac,
    datos.app,
    datos.plataforma,
    datos.valor,
    datos.compartida,
    datos.url,
    datos.fecha_contratacion,
    datos.fecha_vencimiento_plan,
    datos.fecha_vencimiento_app
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A1`,
    valueInputOption: 'RAW',
    requestBody: {
      values: [fila]
    }
  });

  return nuevoId;
}



// Ruta PUT para actualizar usuario
app.put('/editar/:id', async (req, res) => {
  const idLimpio = req.params.id.trim();
  const { id, ...datosParaValidar } = req.body; // excluye id del body para no modificar

  // Validar datos sin id
  const errores = validarUsuario(datosParaValidar);
  if (errores.length > 0) {
    return res.status(400).send(`Errores: ${errores.join(', ')}`);
  }

  try {
    const usuarios = await obtenerUsuariosDesdeSheets();

    const indice = usuarios.findIndex(u => u.id === idLimpio);
    if (indice === -1) return res.status(404).send('Usuario no encontrado');

    usuarios[indice] = { ...usuarios[indice], ...datosParaValidar, id: idLimpio };

    await guardarUsuariosEnSheets(usuarios);

    res.send(`Usuario con ID ${idLimpio} actualizado correctamente`);
  } catch (error) {
    console.error('Error al actualizar usuario:', error);
    res.status(500).send('Error interno del servidor');
  }
});

app.delete('/eliminar/:id', async (req, res) => {
  try {
    const idLimpio = req.params.id.trim();

    // Llama a la función para borrar datos de la hoja
    await borrarDatos(idLimpio);

    // Redirige a la vista que muestra todos los usuarios
    res.redirect('/mostrar-todos');
  } catch (error) {
    console.error('Error al borrar datos:', error);
    res.status(500).send('Error al borrar datos: ' + error.message);
  }
});


app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
});
