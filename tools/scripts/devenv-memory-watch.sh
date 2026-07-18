#!/bin/bash

# devenv-memory-watch.sh - sample container memory over time and flag likely culprits

set -euo pipefail

readonly DEFAULT_INTERVAL_MINUTES=10
readonly DEFAULT_TOP_COUNT=10
readonly DEFAULT_MAX_PROCESSES=250
readonly DEFAULT_STATE_SUBDIR=".debug/devenv-memory-watch"
readonly LEGACY_STATE_SUBDIR=".debug/devcontainer-memory-watch"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEVENV_ROOT="${DEVENV_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
STATE_DIR="${STATE_DIR:-}"
if [ -z "$STATE_DIR" ]; then
	if [ -d "$DEVENV_ROOT/$DEFAULT_STATE_SUBDIR" ] || [ ! -d "$DEVENV_ROOT/$LEGACY_STATE_SUBDIR" ]; then
		STATE_DIR="$DEVENV_ROOT/$DEFAULT_STATE_SUBDIR"
	else
		STATE_DIR="$DEVENV_ROOT/$LEGACY_STATE_SUBDIR"
	fi
fi

SAMPLES_FILE="$STATE_DIR/samples.tsv"
PROCESSES_FILE="$STATE_DIR/processes.tsv"
CURRENT_CULPRITS_FILE="$STATE_DIR/current-culprits.tsv"
LOCK_FILE="$STATE_DIR/.lock"

INTERVAL_MINUTES="$DEFAULT_INTERVAL_MINUTES"
TOP_COUNT="$DEFAULT_TOP_COUNT"
MAX_PROCESSES="${DEVENV_MEMORY_WATCH_MAX_PROCESSES:-$DEFAULT_MAX_PROCESSES}"
RESET_STATE=0
ONCE=0

show_usage() {
	cat <<EOF
Usage: devenv-memory-watch [OPTIONS]

Samples container memory usage over time, persists history in a state directory,
and writes a compact current-culprits TSV for the latest analysis.

Options:
  -h, --help                 Show this help message and exit
  -i, --interval-minutes N    Sample every N minutes (default: $DEFAULT_INTERVAL_MINUTES)
  -t, --top N                Show the top N culprits in the summary TSV (default: $DEFAULT_TOP_COUNT)
  -s, --state-dir PATH        Directory used to store samples and progress (default: $DEVENV_ROOT/$DEFAULT_STATE_SUBDIR)
  -m, --max-processes N       Maximum processes captured per sample (default: $DEFAULT_MAX_PROCESSES)
  -r, --reset                 Clear persisted history before starting
  -o, --once                  Capture one sample, print a report, then exit

Environment Variables:
  DEVENV_ROOT                         Repo root used when --state-dir is not supplied
  STATE_DIR                           Overrides the persisted state directory
  DEVENV_MEMORY_WATCH_MAX_PROCESSES   Overrides the per-sample process cap

Examples:
  devenv-memory-watch
  devenv-memory-watch --interval-minutes 5
  devenv-memory-watch --state-dir /workspaces/devenv/.debug/devenv-memory-watch --once
  devenv-memory-watch --interval-minutes 15 --top 5
EOF
}

die() {
	echo "ERROR: $1" >&2
	exit 1
}

is_positive_integer() {
	[[ "$1" =~ ^[0-9]+$ ]] && [ "$1" -gt 0 ]
}

humanize_kb() {
	local value="${1:-0}"
	awk -v kb="$value" 'BEGIN {
		value = kb + 0;
		if (value >= 1024 * 1024) {
			printf "%.1f GB", value / (1024 * 1024);
		} else if (value >= 1024) {
			printf "%.1f MB", value / 1024;
		} else {
			printf "%d KB", value;
		}
	}'
}

humanize_bytes() {
	local value="${1:-0}"
	awk -v bytes="$value" 'BEGIN {
		value = bytes + 0;
		if (value >= 1024 * 1024 * 1024 * 1024) {
			printf "%.1f TB", value / (1024 * 1024 * 1024 * 1024);
		} else if (value >= 1024 * 1024 * 1024) {
			printf "%.1f GB", value / (1024 * 1024 * 1024);
		} else if (value >= 1024 * 1024) {
			printf "%.1f MB", value / (1024 * 1024);
		} else if (value >= 1024) {
			printf "%.1f KB", value / 1024;
		} else {
			printf "%d B", value;
		}
	}'
}

compact_signature() {
	local signature="${1:-}"

	awk -v signature="$signature" 'BEGIN {
		max_tokens = 6;
		max_length = 110;

		split(signature, parts, /[[:space:]]\|[[:space:]]/);
		comm = parts[1];
		args = parts[2];

		if (args == "") {
			print comm;
			exit;
		}

		n = split(args, tokens, /[[:space:]]+/);
		out = "";

		for (i = 1; i <= n && i <= max_tokens; i++) {
			token = tokens[i];
			if (token == "") {
				continue;
			}

			if (token ~ /^\//) {
				count = split(token, path_parts, "/");
				token = path_parts[count];
			}

			if (token == "") {
				continue;
			}

			if (out == "") {
				out = token;
			} else {
				out = out " " token;
			}
		}

		if (out == "") {
			out = comm;
		}

		if (n > max_tokens || length(args) > max_length) {
			out = out " ...";
		}

		print out;
	}'
}

format_timestamp() {
	local timestamp="$1"

	if date -d "@$timestamp" '+%Y-%m-%d %H:%M:%S %Z' >/dev/null 2>&1; then
		date -d "@$timestamp" '+%Y-%m-%d %H:%M:%S %Z'
	elif date -r "$timestamp" '+%Y-%m-%d %H:%M:%S %Z' >/dev/null 2>&1; then
		date -r "$timestamp" '+%Y-%m-%d %H:%M:%S %Z'
	else
		echo "$timestamp"
	fi
}

read_cgroup_value() {
	local primary_path="$1"
	local fallback_path="${2:-}"

	if [ -r "$primary_path" ]; then
		cat "$primary_path"
	elif [ -n "$fallback_path" ] && [ -r "$fallback_path" ]; then
		cat "$fallback_path"
	else
		echo "0"
	fi
}

initialize_state() {
	mkdir -p "$STATE_DIR"

	if [ "$RESET_STATE" -eq 1 ]; then
		rm -f "$SAMPLES_FILE" "$PROCESSES_FILE" "$CURRENT_CULPRITS_FILE"
	fi

	touch "$SAMPLES_FILE" "$PROCESSES_FILE"
}

next_sample_id() {
	local last_sample_id=0

	if [ -s "$SAMPLES_FILE" ]; then
		last_sample_id="$(awk -F '\t' '$1 == "S" { sample_id = $2 } END { if (sample_id == "") { print 0 } else { print sample_id } }' "$SAMPLES_FILE")"
	fi

	echo $((last_sample_id + 1))
}

collect_process_snapshot() {
	local sample_id="$1"

	ps -eo pid=,ppid=,rss=,comm=,args= --sort=-rss \
		| head -n "$MAX_PROCESSES" \
		| awk -v sample_id="$sample_id" 'BEGIN { OFS = "\t" }
			{
				rss = $3;
				comm = $4;
				$1 = "";
				$2 = "";
				$3 = "";
				$4 = "";
				sub(/^[[:space:]]+/, "", $0);
				gsub(/[[:space:]]+/, " ", $0);
				if ($0 == "") {
					args = comm;
				} else {
					args = $0;
				}
				signature = comm " | " args;
				gsub(/\t/, " ", signature);
				print "P", sample_id, rss, signature;
			}' >> "$PROCESSES_FILE"
}

capture_sample() {
	local sample_id="$1"
	local timestamp="$2"
	local cgroup_current="$3"
	local cgroup_max="$4"

	printf 'S\t%s\t%s\t%s\t%s\n' "$sample_id" "$timestamp" "$cgroup_current" "$cgroup_max" >> "$SAMPLES_FILE"
	collect_process_snapshot "$sample_id"
}

build_current_culprit_rows() {
	awk -F '\t' '
		FNR == NR {
			if ($1 == "S") {
				sample_time[$2] = $3;
				next;
			}
			next;
		}
		$1 == "P" {
			sample_id = $2 + 0;
			rss = $3 + 0;
			signature = $4;
			sample_total[sample_id SUBSEP signature] += rss;
		}
		END {
			for (key in sample_total) {
				split(key, parts, SUBSEP);
				sample_id = parts[1] + 0;
				signature = parts[2];
				total = sample_total[key] + 0;

				if (!(signature in seen)) {
					seen[signature] = 1;
					first_rss[signature] = total;
					first_sample[signature] = sample_id;
					first_time[signature] = sample_time[sample_id];
				} else if (sample_id < first_sample[signature]) {
					first_rss[signature] = total;
					first_sample[signature] = sample_id;
					first_time[signature] = sample_time[sample_id];
				}

				if (!(signature in last_sample) || sample_id > last_sample[signature]) {
					last_rss[signature] = total;
					last_sample[signature] = sample_id;
					last_time[signature] = sample_time[sample_id];
				}

				if (!(signature in peak_rss) || total > peak_rss[signature]) {
					peak_rss[signature] = total;
				}

				sample_hits[signature]++;
			}

			for (signature in seen) {
				delta = last_rss[signature] - first_rss[signature];
				printf "%d\t%d\t%d\t%d\t%d\t%d\t%d\t%s\t%s\t%s\n", delta, last_rss[signature], peak_rss[signature], first_rss[signature], sample_hits[signature], first_sample[signature], last_sample[signature], first_time[signature], last_time[signature], signature;
			}
		}
	' "$SAMPLES_FILE" "$PROCESSES_FILE"
}

write_current_culprits_tsv() {
	local output_file="$1"
	local rank=1

	{
		printf 'rank\tlabel\tcurrent\tdelta\tpeak\tsamples\tfirst_sample\tlast_sample\tfirst_seen\tlast_seen\tsignature\n'
		while IFS=$'\t' read -r delta current peak _ hits first_sample last_sample first_time last_time signature; do
			printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
				"$rank" \
				"$(compact_signature "$signature")" \
				"$(humanize_kb "$current")" \
				"$(humanize_kb "$delta")" \
				"$(humanize_kb "$peak")" \
				"$hits" \
				"$first_sample" \
				"$last_sample" \
				"$(format_timestamp "$first_time")" \
				"$(format_timestamp "$last_time")" \
				"$signature"
			rank=$((rank + 1))
		done < <(
			build_current_culprit_rows \
				| sort -nr -k2,2 -k1,1 \
				| head -n "$TOP_COUNT"
		)
	} > "$output_file"
}

render_report() {
	local sample_count latest_sample_id latest_timestamp latest_current latest_max top_line

	sample_count="$(awk -F '\t' '$1 == "S" { count++ } END { print count + 0 }' "$SAMPLES_FILE")"
	if [ "$sample_count" -eq 0 ]; then
		echo "No samples recorded yet."
		return 0
	fi

	latest_sample_id="$(awk -F '\t' '$1 == "S" { sample_id = $2 } END { print sample_id }' "$SAMPLES_FILE")"
	latest_timestamp="$(awk -F '\t' '$1 == "S" { timestamp = $3 } END { print timestamp }' "$SAMPLES_FILE")"
	latest_current="$(awk -F '\t' '$1 == "S" { current = $4 } END { print current }' "$SAMPLES_FILE")"
	latest_max="$(awk -F '\t' '$1 == "S" { max = $5 } END { print max }' "$SAMPLES_FILE")"

	write_current_culprits_tsv "$CURRENT_CULPRITS_FILE"

	echo "Samples recorded: $sample_count"
	echo "Latest sample: #$latest_sample_id at $(format_timestamp "$latest_timestamp")"
	echo "Cgroup memory current: $(humanize_bytes "$latest_current")"
	if [ "$latest_max" != "max" ]; then
		echo "Cgroup memory max: $(humanize_bytes "$latest_max")"
	else
		echo "Cgroup memory max: unlimited"
	fi

	echo "Current culprit summary: $CURRENT_CULPRITS_FILE"

	top_line="$(awk -F '\t' 'NR == 2 { print $2 "\t" $3 "\t" $4 "\t" $5 }' "$CURRENT_CULPRITS_FILE" | head -n 1)"
	if [ -n "$top_line" ]; then
		local top_label top_current top_delta top_peak
		IFS=$'\t' read -r top_label top_current top_delta top_peak <<EOF
$top_line
EOF
		echo "Top current culprit: $top_label | current $top_current | delta $top_delta | peak $top_peak"
	fi
}

run_monitor() {
	initialize_state

	exec 9>"$LOCK_FILE"
	if ! flock -n 9; then
		die "Another memory watch is already running in $STATE_DIR"
	fi

	local sleep_seconds=$((INTERVAL_MINUTES * 60))

	trap 'exit 130' INT TERM

	while true; do
		local sample_id timestamp cgroup_current cgroup_max

		sample_id="$(next_sample_id)"
		timestamp="$(date +%s)"
		cgroup_current="$(read_cgroup_value /sys/fs/cgroup/memory.current /sys/fs/cgroup/memory.usage_in_bytes)"
		cgroup_max="$(read_cgroup_value /sys/fs/cgroup/memory.max /sys/fs/cgroup/memory.limit_in_bytes)"

		capture_sample "$sample_id" "$timestamp" "$cgroup_current" "$cgroup_max"

		echo "Captured sample #$sample_id into $STATE_DIR"
		render_report

		if [ "$ONCE" -eq 1 ]; then
			break
		fi

		sleep "$sleep_seconds"
	done
}

main() {
	while [ "$#" -gt 0 ]; do
		case "$1" in
			-h|--help)
				show_usage
				exit 0
				;;
			-i|--interval-minutes)
				shift
				[ "$#" -gt 0 ] || die "--interval-minutes requires a value"
				is_positive_integer "$1" || die "--interval-minutes must be a positive integer"
				INTERVAL_MINUTES="$1"
				;;
			-t|--top)
				shift
				[ "$#" -gt 0 ] || die "--top requires a value"
				is_positive_integer "$1" || die "--top must be a positive integer"
				TOP_COUNT="$1"
				;;
			-s|--state-dir)
				shift
				[ "$#" -gt 0 ] || die "--state-dir requires a value"
				STATE_DIR="$1"
				SAMPLES_FILE="$STATE_DIR/samples.tsv"
				PROCESSES_FILE="$STATE_DIR/processes.tsv"
				CURRENT_CULPRITS_FILE="$STATE_DIR/current-culprits.tsv"
				LOCK_FILE="$STATE_DIR/.lock"
				;;
			-m|--max-processes)
				shift
				[ "$#" -gt 0 ] || die "--max-processes requires a value"
				is_positive_integer "$1" || die "--max-processes must be a positive integer"
				MAX_PROCESSES="$1"
				;;
			-r|--reset)
				RESET_STATE=1
				;;
			-o|--once)
				ONCE=1
				;;
			*)
				die "Unknown argument: $1"
				;;
		esac
		shift
	done

	run_monitor
}

main "$@"