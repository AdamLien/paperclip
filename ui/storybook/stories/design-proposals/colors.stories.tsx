import type { Meta, StoryObj } from "@storybook/react-vite";
import { ColorsPreview } from "../../support/design-proposals/ColorsPreview";

const meta = {
  id: "design-foundations-colors",
  title: "Design proposals/Foundations/Colors (dark mode)",
  component: ColorsPreview,
  globals: { theme: "dark" },
  args: { section: "tokens" },
  argTypes: { section: { control: false } },
  parameters: {
    layout: "fullscreen",
    docs: { description: { component: "These color tokens and usage rules apply only to dark mode. Light-mode colors are not defined by this proposal. The neutral palette comes from Paper’s Dark mode frame; the focus ring derives from dark-color-foreground. Token reference reads current dark-theme CSS values; Surfaces & elevation uses shared Card and Input primitives; Text & interaction uses TaskList and its real Columns menu. The proposal decorator scopes the dark semantic theme, including portals, without changing production stories. This palette is staged for design review; task-status colors are outside this reference." } },
    paperclip: {
      capabilities: [],
      home: "design-proposals",
      status: "proposed",
      exception: "Shared dark-mode color foundation for the staged refresh; it does not define light-mode colors or establish production feature coverage.",
      implementation: "production",
      boundary: "fixtures",
      notes: "Demonstrates the actual semantic CSS tokens and shared Card, Input, TaskList and dropdown components. Focus indicators use a foreground edge and a soft foreground halo at 20% opacity; their color and width tokens are shared. Pane resize controls retain their neutral gray highlight. Task data and menu preferences are local fixtures. Cards expose low, middle and high surface levels only in the proposal theme. Dark mode reference only; no light palette, status-color refresh, backend behavior or production adoption is implied.",
    },
  },
} satisfies Meta<typeof ColorsPreview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TokenReference: Story = { name: "Token reference" };
export const SurfacesAndElevation: Story = { name: "Surfaces & elevation", args: { section: "surfaces" } };
export const TextAndInteraction: Story = { name: "Text & interaction", args: { section: "interaction" } };
