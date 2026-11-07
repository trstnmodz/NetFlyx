import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';

const MAX_IDS = 100;
const text = (value, max = 200) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const isEmail = (value) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
const idList = (value) =>
  Array.isArray(value)
    ? value.filter((id) => typeof id === 'string' && id.length > 0).slice(0, MAX_IDS)
    : [];
const rows = (result) => (Array.isArray(result) ? result : (result && result.items) || []);

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch((e) => (e.status === 401 ? null : Promise.reject(e)));
    if (!user) {
      return Response.json({ error: 'Sign in to use the admin panel' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const action = text(body.action, 40);
    const svc = base44.asServiceRole;
    const callerEmail = (user.email || '').toLowerCase();

    const members = rows(await svc.entities.AdminMember.list());
    const activeEmails = members
      .filter((member) => member.active !== false && member.email)
      .map((member) => String(member.email).toLowerCase());

    const isAdmin = user.role === 'admin' || activeEmails.includes(callerEmail);

    const writeLog = (entry) =>
      svc.entities.AdminLog.create({
        actor_email: user.email || 'unknown',
        actor_id: user.id,
        outcome: 'success',
        action: 'admin.unknown',
        ...entry,
      });

    if (action === 'whoami') {
      return Response.json({
        authed: true,
        authorized: isAdmin,
        email: user.email,
        role: user.role,
      });
    }

    if (!isAdmin) {
      // whoami is asked on ordinary pages to decide what to show, so only real
      // admin actions are worth recording as blocked attempts.
      if (action !== 'whoami') {
        await writeLog({
          action: 'admin.denied',
          outcome: 'denied',
          summary: `Blocked "${action || 'request'}" from a non-administrator`,
        }).catch(() => {});
      }
      return Response.json({ error: 'Administrator access required' }, { status: 403 });
    }

    switch (action) {
      case 'listAdmins': {
        const sorted = [...members].sort((a, b) => String(a.email).localeCompare(String(b.email)));
        return Response.json({ members: sorted, callerEmail });
      }

      case 'addAdmin': {
        const nextEmail = text(body.email, 180).toLowerCase();
        if (!isEmail(nextEmail)) {
          return Response.json({ error: 'Enter a valid email address' }, { status: 400 });
        }
        const existing = members.find((member) => String(member.email || '').toLowerCase() === nextEmail);
        if (existing) {
          if (existing.active !== false) {
            return Response.json({ error: 'That email already has access' }, { status: 400 });
          }
          const reactivated = await svc.entities.AdminMember.update(existing.id, {
            active: true,
            note: text(body.note, 140),
            added_by: user.email || '',
          });
          await writeLog({
            action: 'access.grant',
            entity: 'AdminMember',
            record_id: existing.id,
            summary: `Restored admin access for ${nextEmail}`,
          });
          return Response.json({ members: rows(await svc.entities.AdminMember.list()), member: reactivated });
        }
        const created = await svc.entities.AdminMember.create({
          email: nextEmail,
          active: true,
          note: text(body.note, 140),
          added_by: user.email || '',
        });
        await writeLog({
          action: 'access.grant',
          entity: 'AdminMember',
          record_id: created.id,
          summary: `Granted admin access to ${nextEmail}`,
        });
        return Response.json({ members: rows(await svc.entities.AdminMember.list()), member: created });
      }

      case 'removeAdmin': {
        const id = text(body.id, 60);
        const member = members.find((row) => row.id === id);
        if (!member) {
          return Response.json({ error: 'That administrator no longer exists' }, { status: 404 });
        }
        const memberEmail = String(member.email || '').toLowerCase();
        if (memberEmail === callerEmail) {
          return Response.json({ error: 'You cannot revoke your own access' }, { status: 400 });
        }
        if (member.active !== false && activeEmails.length <= 1) {
          return Response.json({ error: 'Keep at least one administrator' }, { status: 400 });
        }
        await svc.entities.AdminMember.delete(id);
        await writeLog({
          action: 'access.revoke',
          entity: 'AdminMember',
          record_id: id,
          summary: `Revoked admin access for ${memberEmail}`,
        });
        return Response.json({ members: rows(await svc.entities.AdminMember.list()) });
      }

      case 'listLogs': {
        const limit = Math.min(Math.max(Number(body.limit) || 60, 1), 200);
        const logs = rows(
          await svc.entities.AdminLog.filter({}, { sort: '-created_date', limit }),
        );
        return Response.json({ logs });
      }

      case 'listUsers': {
        const users = rows(await svc.entities.User.list());
        return Response.json({
          users: users.map((row) => ({
            id: row.id,
            email: row.email || '',
            full_name: row.full_name || '',
            role: row.role || 'user',
            created_date: row.created_date || '',
          })),
        });
      }

      case 'listSuggestions': {
        const suggestions = rows(
          await svc.entities.TitleSuggestion.filter({}, { sort: '-created_date', limit: 200 }),
        );
        return Response.json({ suggestions });
      }

      case 'decideSuggestion': {
        const id = text(body.id, 60);
        const decision = body.decision === 'approved' || body.decision === 'rejected' ? body.decision : '';
        if (!id || !decision) {
          return Response.json({ error: 'A request and a decision are required' }, { status: 400 });
        }
        const existing = await svc.entities.TitleSuggestion.get(id).catch(() => null);
        if (!existing) {
          return Response.json({ error: 'That request no longer exists' }, { status: 404 });
        }
        const updated = await svc.entities.TitleSuggestion.update(id, {
          status: decision,
          decision_note: text(body.note, 400),
          reviewed_by: user.email || '',
          reviewed_at: new Date().toISOString(),
        });
        await writeLog({
          action: decision === 'approved' ? 'suggestion.approve' : 'suggestion.reject',
          entity: 'TitleSuggestion',
          record_id: id,
          summary: `${decision === 'approved' ? 'Approved' : 'Rejected'} the request for "${text(existing.name, 120)}"`,
        });
        return Response.json({ suggestion: updated });
      }

      case 'log': {
        const summary = text(body.summary, 300);
        if (!summary) {
          return Response.json({ error: 'summary is required' }, { status: 400 });
        }
        const entry = await writeLog({
          action: text(body.action, 60) || 'content.update',
          entity: text(body.entity, 40),
          record_id: text(body.recordId, 60),
          summary,
        });
        return Response.json({ log: entry });
      }

      case 'deleteTitles': {
        const ids = idList(body.ids);
        if (!ids.length) {
          return Response.json({ error: 'No titles selected' }, { status: 400 });
        }
        const targets = rows(await svc.entities.Title.filter({ id: { $in: ids } }, { limit: MAX_IDS }));
        await svc.entities.Subtitle.deleteMany({ title_id: { $in: ids } });
        await svc.entities.Title.deleteMany({ id: { $in: ids } });
        if (targets.length) {
          await svc.entities.AdminLog.bulkCreate(
            targets.map((row) => ({
              actor_email: user.email || 'unknown',
              actor_id: user.id,
              action: 'title.delete',
              entity: 'Title',
              record_id: row.id,
              summary: `Deleted "${text(row.name, 120)}"`,
              outcome: 'success',
            })),
          );
        }
        return Response.json({ deleted: targets.length });
      }

      case 'setFeatured': {
        const ids = idList(body.ids);
        const featured = body.featured === true;
        if (!ids.length) {
          return Response.json({ error: 'No titles selected' }, { status: 400 });
        }
        await svc.entities.Title.bulkUpdate(ids.map((id) => ({ id, featured })));
        await writeLog({
          action: featured ? 'title.feature' : 'title.unfeature',
          entity: 'Title',
          summary: `${featured ? 'Featured' : 'Unfeatured'} ${ids.length} title(s)`,
        });
        return Response.json({ updated: ids.length });
      }

      case 'deleteSubtitles': {
        const ids = idList(body.ids);
        if (!ids.length) {
          return Response.json({ error: 'No subtitles selected' }, { status: 400 });
        }
        const targets = rows(
          await svc.entities.Subtitle.filter({ id: { $in: ids } }, { limit: MAX_IDS }),
        );
        await svc.entities.Subtitle.deleteMany({ id: { $in: ids } });
        if (targets.length) {
          await svc.entities.AdminLog.bulkCreate(
            targets.map((row) => ({
              actor_email: user.email || 'unknown',
              actor_id: user.id,
              action: 'subtitle.delete',
              entity: 'Subtitle',
              record_id: row.id,
              summary: `Removed the ${row.label || 'subtitle'} track`,
              outcome: 'success',
            })),
          );
        }
        return Response.json({ deleted: targets.length });
      }

      default:
        return Response.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}