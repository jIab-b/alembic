defmodule Alembic.AgentEventsTest do
  use ExUnit.Case, async: false
  alias SandboxWorker.Local, as: L
  alias SandboxWorker.LocalAgents, as: A

  setup do
    root = "/tmp/alembic-agent-events-" <> SandboxWorker.id()
    previous = Map.new(~w(SW_STORE SW_ROLE), &{&1, System.get_env(&1)})
    System.put_env(%{"SW_STORE" => root, "SW_ROLE" => "local"})
    :ets.new(L, [:named_table, :public, :set])
    w = %{"id" => "project", "path" => root <> "/test"}
    v = %{"id" => "live", "workspace" => w["id"]}
    L.put({:workspace, w["id"]}, w)
    L.put({:vm, v["id"]}, v)
    File.mkdir_p!(SandboxWorker.LocalHistory.dir(w))
    on_exit(fn ->
      for {key, value} <- previous, do: if(value, do: System.put_env(key, value), else: System.delete_env(key))
      File.rm_rf!(root)
    end)
    %{w: w, v: v}
  end

  test "discovery retains the caller's PATH for later browser requests, scoped to the VM", %{w: w, v: v} do
    File.mkdir_p!(w["path"])
    File.write!(w["path"] <> "/.vps", "agents = ['custom-agent']\n")
    for name <- ~w(claude codex opencode custom-agent) do
      File.write!(w["path"] <> "/" <> name, "#!/bin/sh\nexit 0\n")
      File.chmod!(w["path"] <> "/" <> name, 0o700)
    end
    assert A.agents(v, %{"path" => w["path"]}) == ~w(claude codex opencode custom-agent)
    configured = L.vm(v["id"])
    assert configured["agent_path"] == w["path"]
    assert A.agents(configured, %{}) == ~w(claude codex opencode custom-agent)
    other = Map.put(v, "id", "another-vm")
    L.put({:vm, other["id"]}, other)
    refute Map.has_key?(L.vm(other["id"]), "agent_path")
    assert A.agents(configured, %{"path" => ""}) == []
    assert L.vm(v["id"])["agent_path"] == ""
  end

  test "command receipts retain session IDs separately from event IDs", %{w: w, v: v} do
    row = %{"id" => "owned-session", "agent" => "codex", "pid" => System.pid() |> String.to_integer(), "external" => false, "attachable" => true}
    first = A.activity(v, row)
    second = A.activity(v, row)
    [a, b] = L.records(w, "events")
    assert a["kind"] == "agent.command"
    assert a["session"] == row["id"]
    assert a["id"] != row["id"]
    assert a["vm"] == v["id"]
    assert a["pid"] == row["pid"]
    assert a["last_command"] == first["last_command"]
    assert b["id"] > a["id"]
    assert b["last_command"] >= a["last_command"]
    assert L.get({:agent_activity, v["id"], row["id"]}) == second
    refute a["external"]
    assert a["attachable"]
    refute Map.has_key?(a, "argv")
  end

  test "external command activity carries a PID without an attachable session", %{w: w, v: v} do
    row = %{"agent" => "opencode", "pid" => System.pid() |> String.to_integer(), "external" => true, "attachable" => false}
    A.activity(v, row)
    [event] = L.records(w, "events")
    assert event["session"] == nil
    assert event["external"]
    refute event["attachable"]
    assert event["agent"] == row["agent"]
    assert event["pid"] == row["pid"]
    assert event["last_command"] > 0
  end

  test "SSH activity without process visibility retains its connection identity", %{w: w, v: v} do
    row = %{"id" => "ssh:30001:40000", "agent" => "ssh", "external" => true, "attachable" => false}
    A.activity(v, row)
    [event] = L.records(w, "events")
    assert event["session"] == row["id"]
    assert event["pid"] == nil
    assert event["external"] and not event["attachable"]
    assert event["last_command"] > 0
  end
end
