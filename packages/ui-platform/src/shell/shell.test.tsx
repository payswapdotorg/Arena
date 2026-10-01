import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  GlobalSearchSlot,
  JobsNotificationsSlot,
  ProfileSlot,
  RoleSwitcherSlot,
  SHELL_SLOT_KINDS,
  WorkspaceSelectorSlot,
} from './slots.js';

const render = (element: React.ReactElement): string =>
  renderToStaticMarkup(element);

describe('shell slot kinds', () => {
  it('is the closed five-region vocabulary of the shared shell (positive)', () => {
    expect([...SHELL_SLOT_KINDS]).toEqual([
      'workspace',
      'role',
      'search',
      'jobs',
      'profile',
    ]);
  });
});

describe('slot placeholders', () => {
  it('render one labelled, inert placeholder per region (positive)', () => {
    const slots = [
      <WorkspaceSelectorSlot key="workspace" />,
      <RoleSwitcherSlot key="role" />,
      <GlobalSearchSlot key="search" />,
      <JobsNotificationsSlot key="jobs" />,
      <ProfileSlot key="profile" />,
    ];
    const documents = slots.map((slot) => render(slot));
    expect(new Set(documents)).toHaveLength(5);
    for (const document of documents) {
      expect(document).toContain('data-arena-slot=');
      expect(document).toContain('title=');
      // Inert by design: no dead interactive controls.
      expect(document).not.toContain('<button');
      expect(document).not.toContain('<a ');
    }
  });

  it('expose their kind and default label (positive)', () => {
    expect(render(<WorkspaceSelectorSlot />)).toContain('data-arena-slot="workspace"');
    expect(render(<WorkspaceSelectorSlot />)).toContain('Workspace');
    expect(render(<RoleSwitcherSlot />)).toContain('data-arena-slot="role"');
    expect(render(<RoleSwitcherSlot />)).toContain('Role');
    expect(render(<GlobalSearchSlot />)).toContain('data-arena-slot="search"');
    expect(render(<JobsNotificationsSlot />)).toContain('data-arena-slot="jobs"');
    expect(render(<ProfileSlot />)).toContain('data-arena-slot="profile"');
  });

  it('accept a custom visible label (positive)', () => {
    expect(render(<WorkspaceSelectorSlot label="Acme Inc" />)).toContain('Acme Inc');
  });

  it('document their future wiring in the tooltip contract (positive)', () => {
    expect(render(<RoleSwitcherSlot />)).toContain('B003');
    expect(render(<ProfileSlot />)).toContain('B004');
    expect(render(<GlobalSearchSlot />)).toContain('B007');
    expect(render(<JobsNotificationsSlot />)).toContain('B014');
  });
});
