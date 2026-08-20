function projectId(match) {
  return decodeURIComponent(match[1]);
}

export async function handleProjectRoutes(req, res, url, {
  getProjects,
  createProject,
  updateProject,
  deleteProject,
  listProjectOnus,
  addProjectOnu,
  updateProjectOnuNote,
  deleteProjectOnu,
  readBody,
  json,
  olts = []
}) {
  if (req.method === "GET" && url.pathname === "/api/admin/projects") {
    await json(res, 200, { rows: await getProjects(Object.fromEntries(url.searchParams)) });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/admin/projects") {
    const body = await readBody(req);
    try {
      await json(res, 200, { ok: true, project: await createProject(body) });
    } catch (error) {
      await json(res, error.status || 500, { ok: false, error: error.message });
    }
    return true;
  }

  const projectMatch = url.pathname.match(/^\/api\/admin\/projects\/([^/]+)$/);
  const projectOnusMatch = url.pathname.match(/^\/api\/admin\/projects\/([^/]+)\/onus$/);
  const projectOnuMatch = url.pathname.match(/^\/api\/admin\/projects\/([^/]+)\/onus\/([^/]+)$/);

  if (projectOnuMatch && req.method === "PUT") {
    const body = await readBody(req);
    try {
      await json(res, 200, {
        ok: true,
        onu: await updateProjectOnuNote(projectId(projectOnuMatch), decodeURIComponent(projectOnuMatch[2]), body)
      });
    } catch (error) {
      await json(res, error.status || 500, { ok: false, error: error.message });
    }
    return true;
  }

  if (projectOnuMatch && req.method === "DELETE") {
    try {
      await json(res, 200, await deleteProjectOnu(projectId(projectOnuMatch), decodeURIComponent(projectOnuMatch[2])));
    } catch (error) {
      await json(res, error.status || 500, { ok: false, error: error.message });
    }
    return true;
  }

  if (projectOnusMatch && req.method === "GET") {
    try {
      await json(res, 200, { ok: true, rows: await listProjectOnus(projectId(projectOnusMatch), olts) });
    } catch (error) {
      await json(res, error.status || 500, { ok: false, error: error.message });
    }
    return true;
  }

  if (projectOnusMatch && req.method === "POST") {
    const body = await readBody(req);
    try {
      await json(res, 200, { ok: true, onu: await addProjectOnu(projectId(projectOnusMatch), body) });
    } catch (error) {
      await json(res, error.status || 500, { ok: false, error: error.message });
    }
    return true;
  }

  if (projectMatch && req.method === "PUT") {
    const body = await readBody(req);
    try {
      await json(res, 200, { ok: true, project: await updateProject(projectId(projectMatch), body) });
    } catch (error) {
      await json(res, error.status || 500, { ok: false, error: error.message });
    }
    return true;
  }

  if (projectMatch && req.method === "DELETE") {
    try {
      await json(res, 200, await deleteProject(projectId(projectMatch)));
    } catch (error) {
      await json(res, error.status || 500, { ok: false, error: error.message });
    }
    return true;
  }

  return false;
}
