import React from "react";
import { v2, localDay } from "../api.js";
import { useLoad } from "../hooks.js";
import { hashFor, plural } from "../format.js";
import { Leaderboard } from "./MyDay.jsx";

export default function Team() {
  const tz = -new Date().getTimezoneOffset();
  const team = useLoad(() => v2("/team/day", { ...localDay(), tz }), []);
  const board = useLoad(() => v2("/leaderboard", { tz }), []);
  if (team.error) return <p className="error">{team.error.message}</p>;
  const rows = team.data || [];
  return (
    <>
      <div className="work-head">
        <h1 className="work-title">Team today</h1>
        <span className="work-date">Whoever is furthest from the goal is listed first</span>
      </div>
      <div className="table-frame">
        <table className="grid">
          <thead>
            <tr><th>Person</th><th>Calls toward goal</th><th className="right">Answered</th><th className="right">Quotations</th><th className="right">Orders</th><th className="right">Late follow-ups</th><th className="right">Not called yet</th><th className="right">Points</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.userId}>
                <td><b>{r.name}</b></td>
                <td>
                  <span className={`meter ${r.goalShare >= 1 ? "meter-good" : r.goalShare < 0.25 ? "meter-bad" : ""}`}>
                    <span className="num">{r.calls} of {r.goalCalls}</span>
                    <progress max="1" value={r.goalShare ?? 0} aria-hidden="true" />
                  </span>
                </td>
                <td className="right num">{r.answered}</td>
                <td className="right num">{r.quotations}</td>
                <td className="right num">{r.won}</td>
                <td className="right num">{r.late > 0 ? <a className="overdue" href={hashFor("/leads", { queue: "overdue", owner: r.userId })}>{r.late}</a> : 0}</td>
                <td className="right num">{r.untouched > 0 ? r.untouched : 0}</td>
                <td className="right num"><b>{r.points}</b></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!team.loading && !rows.length && <div className="empty"><b>No team members</b>Add people to see their day here.</div>}
      </div>
      <h2 className="section-title section-gap">This week, by points</h2>
      <Leaderboard rows={board.data || []} />
      <p className="muted gauge-note">{plural(rows.length, "person", "people")}. Points count answered calls of 10 seconds or more, the first two unanswered tries per lead each day, quotations, orders and on-time follow-ups.</p>
    </>
  );
}
