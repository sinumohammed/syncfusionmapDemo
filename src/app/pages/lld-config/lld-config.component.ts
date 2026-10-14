import { Component } from "@angular/core";
import { dcTag } from "../../nx-lld/model/dc-tag.model";

// "/lld" page — just hosts <app-nx-lld-config>, which owns the whole screen,
// and plays the host's hierarchy for it.
@Component({
  selector: "app-lld-config",
  templateUrl: "./lld-config.component.html",
  styleUrls: ["./lld-config.component.scss"]
})
export class LldConfigComponent {
  // TODO(host): bind the host's own hierarchy selection instead, assigning
  // a new array whenever it changes. This is the sample request captured
  // from the host (FAHUD).
  // TODO(host): bind the logged-in user instead. This one is from the
  // captured sample save request.
  currentUser = "1337";

  hierarchyTags: dcTag[] = [
    {
      TagID: 4251,
      TagName: "FAHUD",
      ElementTypeID: 6505,
      SourceObjectID: 1062841,
      ObjectID: 1062841,
      IsLazyLoading: false,
      IsShallowsearch: false,
      isSelected: false,
      dataStoreOptions: { getLastest: false, storeInClient: true },
      isRemovable: false,
      CategoryID: 1631,
      SourceClassID: 28,
      IsWildCard: false,
      IsDeleted: false,
      isDisabled: false,
      borderColor: ""
    }
  ];
}
