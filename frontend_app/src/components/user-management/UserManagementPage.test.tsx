// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { UserManagementProvider } from "./UserManagementContext";
import { UserManagementPage } from "./UserManagementPage";

describe("UserManagementPage", () => {
  it("renders without crashing", () => {
    render(
      <UserManagementProvider>
        <UserManagementPage />
      </UserManagementProvider>
    );
  // Minimal assertion without jest-dom matchers; tolerate multiple matches
  const matches = screen.getAllByText(/User Management/i);
  expect(matches.length).toBeGreaterThan(0);
  });
});
