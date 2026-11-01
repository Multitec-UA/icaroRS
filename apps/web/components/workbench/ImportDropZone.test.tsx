import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { LocaleProvider } from "@/components/i18n/LocaleProvider";
import { ImportDropZone } from "./ImportDropZone";

function renderZone(onFile = vi.fn(), compact = false) {
  render(
    <LocaleProvider initialLocale="en">
      <ImportDropZone
        compact={compact}
        title="Drop your OpenRocket file here"
        inputLabel="OpenRocket file"
        inputName="rocket-file"
        onFile={onFile}
      />
    </LocaleProvider>,
  );
  return onFile;
}

describe("ImportDropZone (S8, S12k)", () => {
  it("shows a visible 'Choose .ork file' button that opens the file input", () => {
    renderZone();
    const input = screen.getByLabelText("OpenRocket file") as HTMLInputElement;
    const click = vi.spyOn(input, "click");

    const button = screen.getByRole("button", { name: "Choose .ork file" });
    fireEvent.click(button);

    expect(click).toHaveBeenCalledTimes(1);
  });

  it("renders the button in the compact layout too", () => {
    renderZone(vi.fn(), true);
    expect(screen.getByRole("button", { name: "Choose .ork file" })).toBeInTheDocument();
  });

  it("still takes a dropped file", () => {
    const onFile = renderZone();
    const file = new File(["<ork/>"], "icarus.ork");
    fireEvent.drop(screen.getByText("Drop your OpenRocket file here"), { dataTransfer: { files: [file] } });
    expect(onFile).toHaveBeenCalledWith(file);
  });
});
