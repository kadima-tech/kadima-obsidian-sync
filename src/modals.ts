import { App, Modal, Setting } from "obsidian";

type ConfirmOptions = {
  title: string;
  message: string;
  confirmText: string;
};

class ConfirmModal extends Modal {
  private settled = false;

  constructor(
    app: App,
    private readonly options: ConfirmOptions,
    private readonly resolve: (confirmed: boolean) => void
  ) {
    super(app);
  }

  override onOpen(): void {
    this.setTitle(this.options.title);
    this.contentEl.createEl("p", { text: this.options.message });

    new Setting(this.contentEl)
      .addButton((button) =>
        button.setButtonText("Cancel").onClick(() => {
          this.close();
        })
      )
      .addButton((button) =>
        button
          .setButtonText(this.options.confirmText)
          .setCta()
          .onClick(() => {
            this.settle(true);
            this.close();
          })
      );
  }

  override onClose(): void {
    this.contentEl.empty();
    // Dismissing the modal any other way — Escape, the close button, clicking
    // outside — is a cancellation.
    this.settle(false);
  }

  private settle(confirmed: boolean): void {
    if (this.settled) {
      return;
    }
    this.settled = true;
    this.resolve(confirmed);
  }
}

export function confirmAction(
  app: App,
  options: ConfirmOptions
): Promise<boolean> {
  return new Promise((resolve) => {
    new ConfirmModal(app, options, resolve).open();
  });
}
