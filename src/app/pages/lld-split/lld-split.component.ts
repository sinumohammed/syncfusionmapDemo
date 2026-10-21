import { Component } from "@angular/core";
import { dcTag } from "../../nx-lld/model/dc-tag.model";
import { LldView } from "../../nx-lld/model/nx-lld.model";
import { LldViewSelectConfig } from "../../nx-lld/nx-lld-view-select.component";

// "/lld-split" page — the LLD screen split into separate components, as the
// host will place them: the View dropdown inside a header, and the View /
// Groups / Sub-groups tabs below taking the picked view as input. Plays the host's
// hierarchy and user like LldConfigComponent does.
@Component({
  selector: "app-lld-split",
  templateUrl: "./lld-split.component.html",
  styleUrls: ["./lld-split.component.scss"]
})
export class LldSplitComponent {
  // Toggle to see the dropdown without its Edit / Delete icons.
  viewSelectConfig: LldViewSelectConfig = { showToolbar: true };

  selectedView: LldView | null = null;

  // TODO(host): bind the host's own hierarchy selection instead. This is the
  // sample request captured from the host (FAHUD).
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
