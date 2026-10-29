package main

import "testing"

func TestParseCardDeepLink(t *testing.T) {
	cases := []struct {
		in   string
		want int64
	}{
		{"mmm://card/42", 42},
		{"mmm://card/42/", 42},
		{"mmm:card/7", 7},
		{"mmm://card/0", 0},        // id 0 treated as none
		{"mmm://plane/3", 0},       // wrong kind
		{"https://example.com", 0}, // not our scheme
		{"mmm://card/abc", 0},      // non-numeric
		{"", 0},
	}
	for _, c := range cases {
		if got := parseCardDeepLink(c.in); got != c.want {
			t.Errorf("parseCardDeepLink(%q) = %d, want %d", c.in, got, c.want)
		}
	}
}
