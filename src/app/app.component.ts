import { Component } from "@angular/core";

// Pure router shell now — a nav bar switching between "/" (MapDashboardComponent,
// this app's existing circular chart + map page) and "/trend"
// (TrendDashboardComponent, circular chart stacked over the bar chart
// collection) plus the <router-outlet> that renders whichever page is
// active (see app.component.html and app-routing.module.ts). Owns no
// widget config of its own anymore — that moved to MapDashboardComponent,
// the page that used to be this component's entire body.
@Component({
  selector: "app-root",
  templateUrl: "./app.component.html",
  styleUrls: ["./app.component.scss"]
})
export class AppComponent {}
