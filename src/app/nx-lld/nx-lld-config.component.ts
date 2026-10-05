import { Component, OnInit } from "@angular/core";
import { forkJoin } from "rxjs";
import { finalize } from "rxjs/operators";
import { LldLookups, LldView } from "./model/nx-lld.model";
import { NxLldService } from "./services/nx-lld.service";

// TODO(host): replace with the logged-in user's API token (the host app
// supplies its own); passed straight through to every LLD API call.
const LLD_API_TOKEN = "";

// The LLD Configuration screen: View dropdown (New/Edit/Delete) over the
// grouped View -> Groups -> Sub-groups -> Equipments layout. Step 1 only
// loads the lookups and views to prove the service; the dropdown, popups
// and grouped panels come next.
@Component({
  selector: "app-nx-lld-config",
  templateUrl: "./nx-lld-config.component.html",
  styleUrls: ["./nx-lld-config.component.scss"]
})
export class NxLldConfigComponent implements OnInit {
  lookups: LldLookups | null = null;
  views: LldView[] = [];
  loading = false;

  constructor(private lldService: NxLldService) {}

  ngOnInit(): void {
    this.loading = true;
    forkJoin([this.lldService.getLookups(LLD_API_TOKEN), this.lldService.getViews(LLD_API_TOKEN)])
      .pipe(finalize(() => (this.loading = false)))
      .subscribe(([lookups, views]) => {
        this.lookups = lookups;
        this.views = views;
      });
  }
}
