import { and, asc, eq, inArray, notInArray, sql } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { departments, employees, roles } from '../db/schema.js';
import { AUTHORITY, DEPARTMENTS, ROLES, agentProfileName } from './definition.js';

export type Employee = typeof employees.$inferSelect;
export type Role = typeof roles.$inferSelect;

export class OrganizationService {
  constructor(private db: DB) {}

  /** Installs the initial AI organization. Idempotent: existing roles/employees are kept. */
  async install(): Promise<{ departments: number; roles: number; employees: number }> {
    for (const [i, d] of DEPARTMENTS.entries()) {
      await this.db.insert(departments).values({ key: d.key, name: d.name, description: d.description, floor: d.floor, sortOrder: i }).onConflictDoNothing();
    }
    for (const r of ROLES) {
      await this.db.insert(roles).values({
        key: r.key, title: r.title, level: r.level, authority: AUTHORITY[r.level], departmentKey: r.dept, reportsTo: r.reportsTo,
        kiroAgent: agentProfileName(r.key), responsibilities: r.responsibilities, capabilities: r.caps,
      }).onConflictDoNothing();
    }
    const existing = await this.db.select({ n: sql<number>`count(*)::int` }).from(employees);
    if ((existing[0]?.n ?? 0) === 0) {
      let seq = 1;
      const managerByRole = new Map<string, string>();
      for (const r of ROLES) {
        for (let i = 1; i <= r.count; i++) {
          const name = r.count > 1 ? `${r.title} ${String(i).padStart(2, '0')}` : r.title;
          const [emp] = await this.db.insert(employees).values({
            code: `EMP-${String(seq++).padStart(3, '0')}`, name, roleKey: r.key, departmentKey: r.dept,
            managerId: r.reportsTo ? managerByRole.get(r.reportsTo) ?? null : null,
          }).returning();
          if (i === 1) managerByRole.set(r.key, emp.id);
        }
      }
    }
    const [d, ro, e] = await Promise.all([
      this.db.select({ n: sql<number>`count(*)::int` }).from(departments),
      this.db.select({ n: sql<number>`count(*)::int` }).from(roles),
      this.db.select({ n: sql<number>`count(*)::int` }).from(employees),
    ]);
    return { departments: d[0].n, roles: ro[0].n, employees: e[0].n };
  }

  async roles(): Promise<Role[]> { return this.db.select().from(roles); }
  async role(key: string): Promise<Role | undefined> { return (await this.db.select().from(roles).where(eq(roles.key, key)))[0]; }
  async employee(id: string): Promise<Employee | undefined> { return (await this.db.select().from(employees).where(eq(employees.id, id)))[0]; }
  async departments() { return this.db.select().from(departments).orderBy(asc(departments.sortOrder)); }
  async employees(): Promise<Employee[]> { return this.db.select().from(employees).orderBy(asc(employees.code)); }

  /** Single-holder roles like the CEO. */
  async firstOfRole(roleKey: string): Promise<Employee | undefined> {
    return (await this.db.select().from(employees).where(eq(employees.roleKey, roleKey)).orderBy(asc(employees.code)).limit(1))[0];
  }

  /**
   * Picks an employee of a role for a new task: prefers IDLE, then least recently active.
   * `exclude` enforces agent independence (e.g. the author can never be the reviewer).
   */
  async pick(roleKey: string, exclude: string[] = []): Promise<Employee | undefined> {
    const cond = exclude.length ? and(eq(employees.roleKey, roleKey), notInArray(employees.id, exclude)) : eq(employees.roleKey, roleKey);
    const rows = await this.db.select().from(employees).where(cond)
      .orderBy(sql`case when ${employees.status} = 'IDLE' then 0 else 1 end`, sql`${employees.lastActiveAt} asc nulls first`, asc(employees.code));
    return rows[0];
  }

  async authorityOf(employeeId: string): Promise<number> {
    const rows = await this.db.select({ authority: roles.authority }).from(employees).innerJoin(roles, eq(employees.roleKey, roles.key)).where(eq(employees.id, employeeId));
    return rows[0]?.authority ?? 0;
  }

  async setStatus(employeeId: string, status: Employee['status'], activity: string | null, taskId: string | null): Promise<void> {
    await this.db.update(employees).set({ status, currentActivity: activity, currentTaskId: taskId, lastActiveAt: new Date() }).where(eq(employees.id, employeeId));
  }

  async byIds(ids: string[]): Promise<Employee[]> {
    if (!ids.length) return [];
    return this.db.select().from(employees).where(inArray(employees.id, ids));
  }
}
